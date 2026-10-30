import { prisma } from "@fintech/models";
import { canViewPii, formatCents } from "@fintech/platform";
import { audit, inTransaction, maskForViewer, requirePageRole } from "@fintech/platform/server";
import { Badge, Card, DetailView, Notice, PageHeader, type BadgeTone } from "@fintech/platform/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TRANSACTIONS_ROLES } from "@/lib/catalog";
import { TIMELINE_TXN_LIMIT, loadLinkedAccounts, loadTimeline, type LinkKind, type TimelineSource } from "../../_lib/customer";

const ts = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16);
const SOURCE_TONE: Record<TimelineSource, BadgeTone> = { transaction: "neutral", refund: "warning", kyc: "info" };
const LINK_LABEL: Record<LinkKind, string> = { device: "Shared device", card: "Shared card", address: "Shared address" };

export default async function CustomerInvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageRole(TRANSACTIONS_ROLES);
  const { id } = await params;
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  // The investigation view is audited for every role; Reviewers' unmasked PII is audited as pii.view.
  const pii = await inTransaction(prisma, async (tx) => {
    await audit(user, { action: "customer.view", entityType: "Customer", entityId: customer.id, metadata: { tool: "transactions" } }, tx);
    const { ssn, dob, address } = customer;
    return maskForViewer(user, { ssn, dob, address }, { entityType: "Customer", entityId: customer.id }, tx);
  });
  const [{ events, txnTotal }, { identifiers, linked }] = await Promise.all([loadTimeline(customer.id), loadLinkedAccounts(customer.id, customer.addressHash)]);

  return (
    <>
      <PageHeader
        title={customer.name}
        description={<span className="font-mono">{customer.id}</span>}
        actions={
          <Link href={`/transactions?customer=${customer.id}`} className="text-sm text-slate-600 hover:underline">
            All transactions for this customer
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        {!canViewPii(user) ? <Notice tone="info">PII is masked for your role. Only Reviewers can see full values.</Notice> : null}
        <DetailView
          sections={[
            {
              title: "Customer",
              fields: [
                { label: "Email", value: customer.email },
                { label: "Risk level", value: <Badge tone={customer.riskLevel === "HIGH" ? "danger" : customer.riskLevel === "MEDIUM" ? "warning" : "neutral"}>{customer.riskLevel}</Badge> },
                { label: "Customer since", value: customer.createdAt.toISOString().slice(0, 10) },
                { label: "SSN", value: <span className="font-mono">{pii.ssn}</span> },
                { label: "Date of birth", value: <span className="font-mono">{pii.dob}</span> },
                { label: "Address", value: pii.address },
              ],
            },
            {
              title: "Identifiers",
              fields: [
                { label: "Devices", value: <span className="font-mono text-xs">{identifiers.devices.join(", ") || "—"}</span> },
                { label: "Cards", value: <span className="font-mono text-xs">{identifiers.cards.join(", ") || "—"}</span> },
                { label: "Address hash", value: <span className="font-mono text-xs">{identifiers.addressHash}</span> },
              ],
            },
          ]}
        />

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Linked accounts ({linked.length})</h2>
          {linked.length === 0 ? (
            <p className="text-sm text-slate-500">No other customer shares a device, card or address with this customer.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-4 font-medium">Customer</th>
                  <th className="py-1 pr-4 font-medium">Risk</th>
                  <th className="py-1 font-medium">Shared with this customer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {linked.map((l) => (
                  <tr key={l.customerId}>
                    <td className="py-2 pr-4">
                      <Link href={`/transactions/customers/${l.customerId}`} className="hover:underline">
                        {l.name} <span className="font-mono text-xs text-slate-500">{l.customerId}</span>
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{l.riskLevel}</td>
                    <td className="flex flex-wrap gap-1 py-2">
                      {l.links.map((link) => (
                        <Badge key={`${link.kind}:${link.value}`} tone={link.kind === "device" ? "danger" : link.kind === "card" ? "warning" : "info"} title={link.value}>
                          {LINK_LABEL[link.kind]}
                        </Badge>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Timeline</h2>
          <p className="mb-3 text-xs text-slate-500">
            Transactions, refunds and KYC events, newest first.
            {txnTotal > TIMELINE_TXN_LIMIT ? ` Showing the ${TIMELINE_TXN_LIMIT} most recent of ${txnTotal.toLocaleString()} transactions.` : ""}
          </p>
          <ol className="divide-y divide-slate-100 text-sm">
            {events.map((e) => (
              <li key={e.key} className="flex flex-wrap items-center gap-3 py-2">
                <span className="w-36 shrink-0 text-slate-500">{ts(e.at)}</span>
                <Badge tone={SOURCE_TONE[e.source]}>{e.source}</Badge>
                <span className="flex-1">
                  {e.href ? (
                    <Link href={e.href} className="hover:underline">
                      {e.title}
                    </Link>
                  ) : (
                    e.title
                  )}{" "}
                  <span className="font-mono text-xs text-slate-500">{e.entityId}</span>
                </span>
                {e.amountCents !== undefined ? <span className="tabular-nums">{formatCents(e.amountCents)}</span> : null}
                {e.status ? <span className="text-xs text-slate-500">{e.status.replace("_", " ")}</span> : null}
              </li>
            ))}
            {events.length === 0 ? <li className="py-2 text-slate-500">No activity.</li> : null}
          </ol>
        </Card>
      </div>
    </>
  );
}
