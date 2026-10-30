import { parseTableParams, type SearchParams } from "@fintech/platform";
import { queryAuditLogs, requirePageRole } from "@fintech/platform/server";
import { DataTable, FilterBar, PageHeader, hrefWith, type Column } from "@fintech/platform/ui";
import type { AuditLog } from "@fintech/models";
import { AUDIT_ROLES } from "@/lib/catalog";
import { AUDIT_FILTER_KEYS, parseAuditFilters } from "./filters";

const SORTABLE = ["createdAt", "action", "actorEmail", "entityType"] as const;

const columns: Column<AuditLog>[] = [
  { key: "createdAt", header: "Time (UTC)", sortable: true, render: (r) => r.createdAt.toISOString().replace("T", " ").slice(0, 19) },
  { key: "actorEmail", header: "Actor", sortable: true, render: (r) => r.actorEmail },
  { key: "action", header: "Action", sortable: true, render: (r) => <code className="text-xs">{r.action}</code> },
  { key: "entityType", header: "Entity", sortable: true, render: (r) => `${r.entityType}:${r.entityId}` },
  {
    key: "changes",
    header: "Details",
    render: (r) => (
      <details className="max-w-md text-xs">
        <summary className="cursor-pointer text-slate-600">view</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify({ before: r.before, after: r.after, metadata: r.metadata }, null, 2)}</pre>
      </details>
    ),
  },
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageRole(AUDIT_ROLES);
  const sp = await searchParams;
  const params = parseTableParams(sp, { sortable: SORTABLE, defaultSort: "createdAt", filterKeys: AUDIT_FILTER_KEYS });
  const { rows, total } = await queryAuditLogs(parseAuditFilters(sp), {
    skip: params.skip,
    take: params.take,
    orderBy: { [params.sort]: params.dir },
  });
  const exportHref = hrefWith("/audit/export", sp, { page: undefined, pageSize: undefined, sort: undefined, dir: undefined });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every mutation and PII view."
        actions={
          <a href={exportHref} className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">
            Export CSV
          </a>
        }
      />
      <FilterBar
        basePath="/audit"
        searchParams={sp}
        fields={[
          { type: "text", name: "actor", label: "Actor (id or email)" },
          { type: "text", name: "entityType", label: "Entity type", placeholder: "KycCase" },
          { type: "text", name: "entityId", label: "Entity id" },
          { type: "text", name: "action", label: "Action (prefix)", placeholder: "approval." },
          { type: "date", name: "from", label: "From" },
          { type: "date", name: "to", label: "To" },
        ]}
      />
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} total={total} params={params} basePath="/audit" searchParams={sp} />
    </>
  );
}
