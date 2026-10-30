import { prisma } from "@fintech/models";
import { canViewPii } from "@fintech/platform";
import { audit, inTransaction, maskForViewer, requirePageRole } from "@fintech/platform/server";
import { Badge, Card, DetailView, Field, Form, Notice, PageHeader, Queue, Select, Textarea } from "@fintech/platform/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { KYC_ROLES } from "@/lib/catalog";
import { claimCase, decideCase, recommendCase, unclaimCase } from "../actions";
import { slaInfo } from "../_lib/queue";
import { MAX_TEXT_LENGTH, claimBlocker, decideBlocker, recommendBlocker, unclaimBlocker } from "../_lib/rules";
import { RiskBadge, StatusBadge } from "../badges";

const fmt = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : null);
const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export default async function KycCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageRole(KYC_ROLES);
  const { id } = await params;
  const kase = await prisma.kycCase.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, email: true, ssn: true, dob: true, address: true, riskLevel: true } },
      assignee: { select: { id: true, name: true } },
      // `fixture` holds what is printed on the document (PII), so it is never loaded here.
      documents: { select: { id: true, kind: true, fileName: true, uploadedAt: true }, orderBy: { uploadedAt: "asc" } },
    },
  });
  if (!kase) notFound();

  // Every case view is audited; for Reviewers, maskForViewer also audits the PII reveal (field names only).
  const pii = await inTransaction(prisma, async (tx) => {
    await audit(user, { action: "kyc_case.view", entityType: "KycCase", entityId: kase.id }, tx);
    const { ssn, dob, address } = kase.customer;
    return maskForViewer(user, { ssn, dob, address, documentNumber: kase.documentNumber }, { entityType: "KycCase", entityId: kase.id }, tx);
  });

  const [people, history] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [kase.assigneeId, kase.recommendedById, kase.decidedById].filter((v): v is string => !!v) } }, select: { id: true, name: true } }),
    prisma.auditLog.findMany({
      where: { entityType: "KycCase", entityId: kase.id, action: { notIn: ["kyc_case.view", "pii.view"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, actorEmail: true, createdAt: true },
    }),
  ]);
  const nameOf = (uid: string | null) => (uid ? (uid === user.id ? "You" : (people.find((p) => p.id === uid)?.name ?? uid)) : null);
  const sla = slaInfo(kase);
  const decide = decideBlocker(kase, user);
  const inQueue = kase.status === "OPEN" || kase.status === "IN_REVIEW";
  const masked = !canViewPii(user);

  return (
    <>
      <PageHeader
        title={`KYC case ${kase.id}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={kase.status} />
            <RiskBadge risk={kase.riskLevel} />
            <span>SLA age {sla.age}</span>
            {sla.overdue ? <Badge tone="danger">{sla.label}</Badge> : <span>· {sla.label}</span>}
          </span>
        }
        actions={
          <Link href="/kyc" className="text-sm text-slate-600 hover:underline">
            ← Back to queue
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {masked ? <Notice tone="info">PII is masked for your role. Only Reviewers can see full values.</Notice> : null}
          <DetailView
            sections={[
              {
                title: "Customer",
                fields: [
                  { label: "Name", value: kase.customer.name },
                  { label: "Customer ID", value: kase.customer.id },
                  { label: "Email", value: kase.customer.email },
                  { label: "SSN", value: <span className="font-mono">{pii.ssn}</span> },
                  { label: "Date of birth", value: <span className="font-mono">{pii.dob}</span> },
                  { label: "Address", value: pii.address },
                  { label: "Customer risk", value: <RiskBadge risk={kase.customer.riskLevel} /> },
                ],
              },
              {
                title: "Case",
                fields: [
                  { label: "Document type", value: kase.documentType.replace("_", " ") },
                  { label: "Document number", value: <span className="font-mono">{pii.documentNumber}</span> },
                  { label: "Document expiry", value: fmtDate(kase.documentExpiry) },
                  { label: "Opened", value: fmt(kase.openedAt) },
                  { label: "SLA due", value: fmt(kase.slaDueAt) },
                  { label: "Assignee", value: nameOf(kase.assigneeId) ?? "Unassigned" },
                ],
              },
              {
                title: "Recommendation (Analyst)",
                fields: [
                  { label: "Recommendation", value: kase.recommendation?.toLowerCase() },
                  { label: "Prepared by", value: nameOf(kase.recommendedById) },
                  { label: "Prepared at", value: fmt(kase.recommendedAt) },
                  { label: "Notes", value: kase.recommendationNotes },
                ],
              },
              {
                title: "Final decision (Reviewer)",
                fields: [
                  { label: "Decision", value: kase.decision?.toLowerCase() },
                  { label: "Decided by", value: nameOf(kase.decidedById) },
                  { label: "Decided at", value: fmt(kase.decidedAt) },
                  { label: "Reason", value: kase.decisionReason },
                ],
              },
            ]}
          />
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Documents</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {kase.documents.map((d) => (
                <li key={d.id} className="flex justify-between py-2">
                  <span>
                    <span className="font-medium">{d.kind.replace(/_/g, " ")}</span> <span className="text-slate-500">{d.fileName}</span>
                  </span>
                  <span className="text-slate-500">{fmt(d.uploadedAt)}</span>
                </li>
              ))}
              {kase.documents.length === 0 ? <li className="py-2 text-slate-500">No documents.</li> : null}
            </ul>
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">History</h2>
            <ol className="flex flex-col gap-1 text-sm">
              <li className="text-slate-600">
                {fmt(kase.openedAt)} · case opened
              </li>
              {history.map((h) => (
                <li key={h.id} className="text-slate-600">
                  {fmt(h.createdAt)} · <code className="text-xs">{h.action}</code> by {h.actorEmail}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {inQueue ? (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Queue</h2>
              <Queue
                itemId={kase.id}
                assigneeName={kase.assignee?.name ?? null}
                isMine={!unclaimBlocker(kase, user)}
                canClaim={!claimBlocker(kase, user)}
                claimAction={claimCase}
                unclaimAction={unclaimCase}
              />
            </Card>
          ) : null}

          {!recommendBlocker(kase, user) ? (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Prepare recommendation</h2>
              <Form action={recommendCase} submitLabel="Submit recommendation">
                <input type="hidden" name="id" value={kase.id} />
                <Field label="Recommendation" htmlFor="recommendation">
                  <Select id="recommendation" name="recommendation" required defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    <option value="APPROVE">Approve</option>
                    <option value="REJECT">Reject</option>
                  </Select>
                </Field>
                <Field label="Notes" htmlFor="notes">
                  <Textarea id="notes" name="notes" required maxLength={MAX_TEXT_LENGTH} />
                </Field>
              </Form>
            </Card>
          ) : null}

          {kase.status === "RECOMMENDED" && decide?.code !== "forbidden" ? (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Final decision</h2>
              {decide ? (
                <Notice tone="warning">{decide.message}</Notice>
              ) : (
                <Form action={decideCase} submitLabel="Record final decision">
                  <input type="hidden" name="id" value={kase.id} />
                  <Field label="Decision" htmlFor="decision">
                    <Select id="decision" name="decision" required defaultValue={kase.recommendation ?? ""}>
                      <option value="APPROVE">Approve</option>
                      <option value="REJECT">Reject</option>
                    </Select>
                  </Field>
                  <Field label="Reason" htmlFor="reason" hint="Required. Recorded on the case and in the audit log.">
                    <Textarea id="reason" name="reason" required maxLength={MAX_TEXT_LENGTH} />
                  </Field>
                </Form>
              )}
            </Card>
          ) : null}

          {kase.status === "RECOMMENDED" && decide?.code === "forbidden" ? (
            <Notice tone="info">Awaiting a Reviewer&apos;s final decision.</Notice>
          ) : null}
        </div>
      </div>
    </>
  );
}
