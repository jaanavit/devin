import { prisma, type Prisma } from "@fintech/models";
import { parseTableParams, type SearchParams } from "@fintech/platform";
import { requirePageRole } from "@fintech/platform/server";
import { Badge, DataTable, FilterBar, PageHeader, type Column } from "@fintech/platform/ui";
import Link from "next/link";
import { KYC_ROLES } from "@/lib/catalog";
import { KYC_FILTER_KEYS, KYC_SORTABLE, kycWhere, slaInfo } from "./_lib/queue";
import { KYC_STATUSES, RISK_LEVELS } from "./_lib/rules";
import { RiskBadge, StatusBadge } from "./badges";

const listSelect = {
  id: true,
  status: true,
  riskLevel: true,
  openedAt: true,
  slaDueAt: true,
  customer: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} as const;

type Row = Prisma.KycCaseGetPayload<{ select: typeof listSelect }>;

export default async function KycQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageRole(KYC_ROLES);
  const sp = await searchParams;
  const params = parseTableParams(sp, { sortable: KYC_SORTABLE, defaultSort: "slaDueAt", defaultDir: "asc", filterKeys: KYC_FILTER_KEYS });
  const where = kycWhere(params.filters, user);
  const [rows, total, analysts] = await Promise.all([
    prisma.kycCase.findMany({ where, select: listSelect, skip: params.skip, take: params.take, orderBy: [{ [params.sort]: params.dir }, { id: "asc" }] }),
    prisma.kycCase.count({ where }),
    prisma.user.findMany({ where: { roles: { has: "Analyst" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();

  const columns: Column<Row>[] = [
    {
      key: "id",
      header: "Case",
      render: (r) => (
        <Link href={`/kyc/${r.id}`} className="font-medium text-slate-900 hover:underline">
          {r.id}
        </Link>
      ),
    },
    { key: "customer", header: "Customer", render: (r) => r.customer.name },
    { key: "status", header: "Status", sortable: true, render: (r) => <StatusBadge status={r.status} /> },
    { key: "riskLevel", header: "Risk", sortable: true, render: (r) => <RiskBadge risk={r.riskLevel} /> },
    { key: "assignee", header: "Assignee", render: (r) => (r.assignee ? (r.assignee.id === user.id ? "You" : r.assignee.name) : <span className="text-slate-400">Unassigned</span>) },
    { key: "openedAt", header: "SLA age", sortable: true, render: (r) => slaInfo(r, now).age },
    {
      key: "slaDueAt",
      header: "SLA",
      sortable: true,
      render: (r) => {
        const sla = slaInfo(r, now);
        return sla.overdue ? <Badge tone="danger">{sla.label}</Badge> : <span className="text-slate-600">{sla.label}</span>;
      },
    },
  ];

  return (
    <>
      <PageHeader title="KYC review queue" description="Analysts claim and prepare cases; a different Reviewer makes the final decision." />
      <FilterBar
        basePath="/kyc"
        searchParams={sp}
        fields={[
          { type: "select", name: "status", label: "Status", options: KYC_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() })) },
          { type: "select", name: "riskLevel", label: "Risk level", options: RISK_LEVELS.map((r) => ({ value: r, label: r.toLowerCase() })) },
          {
            type: "select",
            name: "assignee",
            label: "Assignee",
            options: [{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...analysts.map((a) => ({ value: a.id, label: a.name }))],
          },
        ]}
      />
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} total={total} params={params} basePath="/kyc" searchParams={sp} emptyMessage="No cases match these filters." />
    </>
  );
}
