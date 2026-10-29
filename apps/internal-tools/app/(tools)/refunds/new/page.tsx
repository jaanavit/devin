import { prisma } from "@fintech/models";
import type { PaymentsTransaction } from "@fintech/models/payments";
import { firstParam, formatCents, parseTableParams, type SearchParams } from "@fintech/platform";
import { requirePageRole } from "@fintech/platform/server";
import { Card, DataTable, DetailView, Field, FilterBar, Form, Input, Notice, PageHeader, Textarea, hrefWith, type Column } from "@fintech/platform/ui";
import Link from "next/link";
import { REFUND_REQUESTER_ROLES } from "@/lib/catalog";
import { createRefund } from "../actions";
import { LARGE_REFUND_ALERT_CENTS, REFUND_POLICY, refundableCents } from "../_lib/policy";
import { searchTransactions } from "../_lib/search";

const BASE = "/refunds/new";

function columns(sp: SearchParams): Column<PaymentsTransaction>[] {
  return [
    { key: "createdAt", header: "Date (UTC)", render: (t) => t.createdAt.slice(0, 10) },
    { key: "id", header: "Transaction", render: (t) => <span className="font-mono text-xs">{t.id}</span> },
    {
      key: "customer",
      header: "Customer",
      render: (t) => (
        <div>
          <div>{t.customerName}</div>
          <div className="font-mono text-xs text-slate-500">{t.customerId}</div>
        </div>
      ),
    },
    { key: "merchant", header: "Merchant", render: (t) => t.merchant },
    { key: "amountCents", header: "Amount", className: "text-right", render: (t) => formatCents(t.amountCents, t.currency) },
    { key: "status", header: "Status", render: (t) => t.status },
    {
      key: "select",
      header: "",
      render: (t) => (
        <Link href={hrefWith(BASE, sp, { transactionId: t.id })} className="text-sm font-medium text-blue-700 hover:underline">
          Select
        </Link>
      ),
    },
  ];
}

export default async function NewRefundPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageRole(REFUND_REQUESTER_ROLES);
  const sp = await searchParams;
  const params = parseTableParams(sp, { sortable: ["createdAt"], defaultSort: "createdAt" });
  const q = firstParam(sp.q)?.trim();
  const transactionId = firstParam(sp.transactionId)?.trim();

  const [search, selected] = await Promise.all([
    q ? searchTransactions({ q, page: params.page, pageSize: params.pageSize }) : null,
    transactionId ? searchTransactions({ q: transactionId, pageSize: 1 }) : null,
  ]);
  const txn = selected?.ok ? selected.page.items.find((t) => t.id === transactionId) : undefined;
  const existing = txn ? await prisma.refund.findMany({ where: { transactionId: txn.id }, select: { amountCents: true, status: true } }) : [];
  const available = txn ? refundableCents(txn.amountCents, existing) : 0;

  return (
    <>
      <PageHeader
        title="New refund"
        description={`Search payments for the transaction to refund. Up to ${formatCents(REFUND_POLICY.autoApproveMaxCents ?? 0)} is approved automatically; larger amounts go to Finance.`}
      />
      <FilterBar basePath={BASE} searchParams={sp} fields={[{ type: "text", name: "q", label: "Customer or transaction ID", placeholder: "cus_… / txn_… / name" }]} />

      {selected && !selected.ok ? <Notice tone="danger">{selected.error}</Notice> : null}
      {selected?.ok && !txn ? <Notice tone="warning">Transaction {transactionId} was not found in payments.</Notice> : null}
      {txn ? (
        <div className="mb-6 flex flex-col gap-4">
          <DetailView
            sections={[
              {
                title: "Selected transaction",
                fields: [
                  { label: "Transaction", value: <span className="font-mono">{txn.id}</span> },
                  { label: "Customer", value: `${txn.customerName} (${txn.customerId})` },
                  { label: "Merchant", value: txn.merchant },
                  { label: "Amount", value: formatCents(txn.amountCents, txn.currency) },
                  { label: "Status", value: txn.status },
                  { label: "Refundable balance", value: formatCents(available) },
                ],
              },
            ]}
          />
          <Card className="p-4">
            {available > 0 ? (
              <Form action={createRefund} submitLabel="Request refund">
                <input type="hidden" name="transactionId" value={txn.id} />
                <Field label="Amount (USD)" htmlFor="amount" hint={`Max ${formatCents(available)}. Over ${formatCents(LARGE_REFUND_ALERT_CENTS)} alerts Finance in Slack.`}>
                  <Input id="amount" name="amount" inputMode="decimal" placeholder="49.99" required />
                </Field>
                <Field label="Reason" htmlFor="reason">
                  <Textarea id="reason" name="reason" maxLength={500} required />
                </Field>
              </Form>
            ) : (
              <Notice tone="warning">Nothing left to refund on this transaction.</Notice>
            )}
          </Card>
        </div>
      ) : null}

      {search && !search.ok ? <Notice tone="danger">{search.error}</Notice> : null}
      {search?.ok ? (
        <DataTable columns={columns(sp)} rows={search.page.items} rowKey={(t) => t.id} total={search.page.total} params={params} basePath={BASE} searchParams={sp} emptyMessage="No transactions match." />
      ) : null}
    </>
  );
}
