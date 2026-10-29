import { prisma } from "@fintech/models";
import { formatCents, hasAnyRole } from "@fintech/platform";
import { requirePageRole } from "@fintech/platform/server";
import { Badge, Card, DetailView, Field, Form, Input, Notice, PageHeader, Textarea } from "@fintech/platform/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REFUND_APPROVER_ROLES, REFUNDS_ROLES } from "@/lib/catalog";
import { approveRefund, rejectRefund, retryRefund } from "../actions";
import { REFUND_STATUS_TONE } from "../_lib/policy";

const ts = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 19) : null);

export default async function RefundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageRole(REFUNDS_ROLES);
  const { id } = await params;
  const refund = await prisma.refund.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } },
      transaction: { select: { merchant: true, amountCents: true, currency: true, status: true, createdAt: true } },
      requestedBy: { select: { name: true, email: true } },
    },
  });
  if (!refund) notFound();
  const [approval, history] = await Promise.all([
    refund.approvalRequestId ? prisma.approvalRequest.findUnique({ where: { id: refund.approvalRequestId }, include: { decidedBy: { select: { name: true } } } }) : null,
    prisma.auditLog.findMany({
      where: { OR: [{ entityType: "Refund", entityId: refund.id }, ...(refund.approvalRequestId ? [{ entityType: "ApprovalRequest", entityId: refund.approvalRequestId }] : [])] },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, actorEmail: true, action: true },
    }),
  ]);

  const pending = refund.status === "PENDING_APPROVAL";
  const isApprover = hasAnyRole(user, REFUND_APPROVER_ROLES);
  const isRequester = refund.requestedById === user.id;

  return (
    <>
      <PageHeader
        title={`Refund ${refund.id}`}
        description={
          <Link href="/refunds" className="hover:underline">
            ← All refunds
          </Link>
        }
        actions={<Badge tone={REFUND_STATUS_TONE[refund.status]}>{refund.status.replace("_", " ")}</Badge>}
      />
      <div className="flex flex-col gap-4">
        <DetailView
          sections={[
            {
              title: "Refund",
              fields: [
                { label: "Amount", value: formatCents(refund.amountCents) },
                { label: "Reason", value: refund.reason },
                { label: "Requested by", value: `${refund.requestedBy.name} (${refund.requestedBy.email})` },
                { label: "Requested at (UTC)", value: ts(refund.createdAt) },
                { label: "Payments refund ID", value: refund.externalRefundId ? <span className="font-mono">{refund.externalRefundId}</span> : null },
                { label: "Processed at (UTC)", value: ts(refund.processedAt) },
              ],
            },
            {
              title: "Transaction",
              fields: [
                { label: "Transaction", value: <span className="font-mono">{refund.transactionId}</span> },
                { label: "Customer", value: `${refund.customer.name} (${refund.customerId})` },
                { label: "Merchant", value: refund.transaction.merchant },
                { label: "Amount", value: formatCents(refund.transaction.amountCents, refund.transaction.currency) },
                { label: "Status", value: refund.transaction.status },
                { label: "Date (UTC)", value: ts(refund.transaction.createdAt) },
              ],
            },
            {
              title: "Approval",
              fields: [
                { label: "Status", value: approval?.status ?? null },
                { label: "Decided by", value: approval?.decidedBy?.name ?? (approval?.status === "AUTO_APPROVED" ? "Automatic (≤ $500)" : null) },
                { label: "Decided at (UTC)", value: ts(approval?.decidedAt) },
                { label: "Reason / note", value: approval?.decisionReason ?? null },
              ],
            },
          ]}
        />

        {pending && !isApprover ? <Notice tone="warning">Awaiting approval by a Finance Reviewer.</Notice> : null}
        {pending && isApprover && isRequester ? <Notice tone="warning">You requested this refund, so another Reviewer must approve it.</Notice> : null}
        {pending && isApprover && !isRequester ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="p-4">
              <Form action={approveRefund} submitLabel="Approve and send to payments">
                <input type="hidden" name="id" value={refund.id} />
                <Field label="Note (optional)" htmlFor="note">
                  <Input id="note" name="note" maxLength={500} />
                </Field>
              </Form>
            </Card>
            <Card className="p-4">
              <Form action={rejectRefund} submitLabel="Reject" variant="destructive">
                <input type="hidden" name="id" value={refund.id} />
                <Field label="Reason (required)" htmlFor="reason">
                  <Textarea id="reason" name="reason" maxLength={500} required />
                </Field>
              </Form>
            </Card>
          </div>
        ) : null}
        {refund.status === "FAILED" ? (
          <Card className="p-4">
            <p className="mb-3 text-sm text-slate-600">The payments call failed. Retrying is safe: payments deduplicates on the refund ID.</p>
            <Form action={retryRefund} submitLabel="Retry payment" variant="secondary">
              <input type="hidden" name="id" value={refund.id} />
            </Form>
          </Card>
        ) : null}

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">History</h2>
          <ol className="flex flex-col gap-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex gap-3">
                <span className="text-slate-500">{ts(h.createdAt)}</span>
                <code className="text-xs leading-5">{h.action}</code>
                <span>{h.actorEmail}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
