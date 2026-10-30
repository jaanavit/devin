import { prisma } from "@fintech/models";
import { ValidationError, formatCents, parseTableParams, type SearchParams } from "@fintech/platform";
import { requirePageRole } from "@fintech/platform/server";
import { Badge, DataTable, FilterBar, Notice, PageHeader, hrefWith, type Column } from "@fintech/platform/ui";
import Link from "next/link";
import { TRANSACTIONS_ROLES } from "@/lib/catalog";
import { CUSTOMER_MATCH_LIMIT, EXPORT_LIMIT, TXN_FILTER_KEYS, TXN_SORTABLE, parseTxnFilters, searchTransactions, type TxnRow, type TxnSearchResult } from "./_lib/search";

const short = (v: string) => (v.length > 14 ? `${v.slice(0, 14)}…` : v);

const columns: Column<TxnRow>[] = [
  { key: "createdAt", header: "Date (UTC)", sortable: true, render: (t) => t.createdAt.toISOString().replace("T", " ").slice(0, 16) },
  { key: "id", header: "Transaction", render: (t) => <span className="font-mono text-xs">{t.id}</span> },
  {
    key: "customer",
    header: "Customer",
    render: (t) => (
      <Link href={`/transactions/customers/${t.customerId}`} className="hover:underline">
        <div>{t.customer.name}</div>
        <div className="font-mono text-xs text-slate-500">{t.customerId}</div>
      </Link>
    ),
  },
  { key: "merchant", header: "Merchant", render: (t) => `${t.merchant}${t.merchantCategoryCode ? ` (${t.merchantCategoryCode})` : ""}` },
  { key: "amountCents", header: "Amount", sortable: true, className: "text-right", render: (t) => formatCents(t.amountCents, t.currency) },
  { key: "status", header: "Status", render: (t) => <Badge>{t.status.replace("_", " ")}</Badge> },
  { key: "deviceId", header: "Device / card", render: (t) => <span className="font-mono text-xs text-slate-600">{short(t.deviceId)} · {short(t.cardFingerprint)}</span> },
];

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageRole(TRANSACTIONS_ROLES);
  const sp = await searchParams;
  const params = parseTableParams(sp, { sortable: TXN_SORTABLE, defaultSort: "createdAt", filterKeys: TXN_FILTER_KEYS });

  let error: string | undefined;
  let result: TxnSearchResult = { rows: [], total: 0 };
  try {
    result = await searchTransactions(parseTxnFilters(sp), params);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    error = err.message;
  }
  const merchants = await prisma.transaction.groupBy({ by: ["merchant"], orderBy: { merchant: "asc" } });
  const exportHref = hrefWith("/transactions/export", sp, { page: undefined, pageSize: undefined });

  return (
    <>
      <PageHeader
        title="Transaction investigation"
        description="Search every transaction. Open a customer to see their merged timeline and linked accounts."
        actions={
          <a href={exportHref} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">
            Export CSV
          </a>
        }
      />
      <FilterBar
        basePath="/transactions"
        searchParams={sp}
        fields={[
          { type: "text", name: "customer", label: "Customer (ID or name)", placeholder: "cus_… or name" },
          { type: "text", name: "txnId", label: "Transaction ID", placeholder: "txn_…" },
          { type: "select", name: "merchant", label: "Merchant", options: merchants.map((m) => ({ value: m.merchant, label: m.merchant })) },
          { type: "text", name: "minAmount", label: "Min amount ($)", placeholder: "0" },
          { type: "text", name: "maxAmount", label: "Max amount ($)", placeholder: "5000" },
          { type: "date", name: "from", label: "From" },
          { type: "date", name: "to", label: "To" },
        ]}
      />
      {error ? (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      {result.customerMatch?.truncated ? (
        <div className="mb-4">
          <Notice tone="warning">The customer name matched more than {CUSTOMER_MATCH_LIMIT} customers; only the first {CUSTOMER_MATCH_LIMIT} are searched. Use a longer name or a customer ID.</Notice>
        </div>
      ) : null}
      {result.total > EXPORT_LIMIT ? <p className="mb-2 text-xs text-slate-500">CSV export is capped at {EXPORT_LIMIT.toLocaleString()} rows; narrow the filters to export everything.</p> : null}
      <DataTable columns={columns} rows={result.rows} rowKey={(t) => t.id} total={result.total} params={params} basePath="/transactions" searchParams={sp} emptyMessage="No transactions match." />
    </>
  );
}
