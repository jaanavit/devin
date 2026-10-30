import { prisma, type Prisma } from "@fintech/models";
import { firstParam, formatCents, hasAnyRole, parseTableParams, type SearchParams } from "@fintech/platform";
import { requirePageRole } from "@fintech/platform/server";
import { Badge, DataTable, FilterBar, Notice, PageHeader, type Column } from "@fintech/platform/ui";
import Link from "next/link";
import { REFUND_REQUESTER_ROLES, REFUNDS_ROLES } from "@/lib/catalog";
import { REFUND_STATUSES, REFUND_STATUS_TONE } from "./_lib/policy";
import { searchTransactions } from "./_lib/search";

const SORTABLE = ["createdAt", "amountCents", "status"] as const;
const SEARCH_LIMIT = 100;

type Row = Prisma.RefundGetPayload<{ include: { customer: { select: { name: true } }; requestedBy: { select: { name: true } } } }>;

const columns: Column<Row>[] = [
  { key: "createdAt", header: "Requested (UTC)", sortable: true, render: (r) => r.createdAt.toISOString().replace("T", " ").slice(0, 16) },
  {
    key: "id",
    header: "Refund",
    render: (r) => (
      <Link href={`/refunds/${r.id}`} className="font-mono text-xs text-blue-700 hover:underline">
        {r.id}
      </Link>
    ),
  },
  {
    key: "customer",
    header: "Customer",
    render: (r) => (
      <div>
        <div>{r.customer.name}</div>
        <div className="font-mono text-xs text-slate-500">{r.customerId}</div>
      </div>
    ),
  },
  { key: "transactionId", header: "Transaction", render: (r) => <span className="font-mono text-xs">{r.transactionId}</span> },
  { key: "amountCents", header: "Amount", sortable: true, className: "text-right", render: (r) => formatCents(r.amountCents) },
  { key: "status", header: "Status", sortable: true, render: (r) => <Badge tone={REFUND_STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</Badge> },
  { key: "requestedBy", header: "Requested by", render: (r) => r.requestedBy.name },
];

export default async function RefundsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageRole(REFUNDS_ROLES);
  const sp = await searchParams;
  const params = parseTableParams(sp, { sortable: SORTABLE, defaultSort: "createdAt", filterKeys: ["status"] });
  const q = firstParam(sp.q)?.trim();
  const status = REFUND_STATUSES.find((s) => s === params.filters.status);

  let searchError: string | undefined;
  let truncated = false;
  const where: Prisma.RefundWhereInput = status ? { status } : {};
  if (q) {
    const result = await searchTransactions({ q, pageSize: SEARCH_LIMIT });
    if (result.ok) {
      const txnIds = result.page.items.map((t) => t.id);
      const customerIds = [...new Set(result.page.items.map((t) => t.customerId))];
      where.OR = [{ transactionId: { in: txnIds } }, { customerId: { in: customerIds } }];
      truncated = result.page.total > SEARCH_LIMIT;
    } else {
      searchError = result.error;
    }
  }

  const [rows, total] = searchError
    ? [[], 0]
    : await prisma.$transaction([
        prisma.refund.findMany({
          where,
          include: { customer: { select: { name: true } }, requestedBy: { select: { name: true } } },
          orderBy: [{ [params.sort]: params.dir }, { id: "asc" }],
          skip: params.skip,
          take: params.take,
        }),
        prisma.refund.count({ where }),
      ]);

  return (
    <>
      <PageHeader
        title="Refunds"
        description="Refunds up to $500 auto-approve. Larger refunds need a Finance Reviewer who did not request them."
        actions={
          hasAnyRole(user, REFUND_REQUESTER_ROLES) ? (
            <Link href="/refunds/new" className="inline-flex h-9 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">
              New refund
            </Link>
          ) : null
        }
      />
      <FilterBar
        basePath="/refunds"
        searchParams={sp}
        fields={[
          { type: "text", name: "q", label: "Customer or transaction ID", placeholder: "cus_… / txn_… / name" },
          { type: "select", name: "status", label: "Status", options: REFUND_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") })) },
        ]}
      />
      {searchError ? <Notice tone="danger">{searchError}</Notice> : null}
      {truncated ? (
        <div className="mb-4">
          <Notice tone="warning">Search matched more than {SEARCH_LIMIT} transactions; refine it (e.g. use a customer ID) to be sure every refund is shown.</Notice>
        </div>
      ) : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} total={total} params={params} basePath="/refunds" searchParams={sp} emptyMessage="No refunds match." />
    </>
  );
}
