import { prisma, type FeatureFlag, type Prisma } from "@fintech/models";
import { ENVIRONMENTS } from "@fintech/models/shared";
import { parseTableParams, type SearchParams } from "@fintech/platform";
import { requirePageRole } from "@fintech/platform/server";
import { DataTable, FilterBar, PageHeader, hrefWith, type Column } from "@fintech/platform/ui";
import Link from "next/link";
import { FLAGS_ROLES } from "@/lib/catalog";
import { EnvironmentBadge, StatusBadge } from "./_lib/badges";
import { FLAG_FILTER_KEYS, isEnvironment } from "./_lib/rules";

const SORTABLE = ["key"] as const;

const columns: Column<FeatureFlag>[] = [
  {
    key: "key",
    header: "Flag",
    sortable: true,
    render: (f) => (
      <Link href={`/flags/${f.id}`} className="font-medium text-slate-900 hover:underline">
        <code>{f.key}</code>
      </Link>
    ),
  },
  { key: "environment", header: "Environment", render: (f) => <EnvironmentBadge environment={f.environment} /> },
  { key: "enabled", header: "Status", render: (f) => <StatusBadge enabled={f.enabled} /> },
  { key: "rolloutPercentage", header: "Rollout", render: (f) => `${f.rolloutPercentage}%` },
  { key: "description", header: "Description", render: (f) => <span className="text-slate-600">{f.description}</span> },
  { key: "updatedAt", header: "Updated (UTC)", render: (f) => f.updatedAt.toISOString().replace("T", " ").slice(0, 16) },
];

export default async function FlagsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageRole(FLAGS_ROLES);
  const sp = await searchParams;
  const params = parseTableParams(sp, { sortable: SORTABLE, defaultSort: "key", defaultDir: "asc", filterKeys: FLAG_FILTER_KEYS });
  const { environment, key } = params.filters;
  const where: Prisma.FeatureFlagWhereInput = {
    ...(isEnvironment(environment) ? { environment } : {}),
    ...(key ? { key: { startsWith: key.toLowerCase() } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.featureFlag.findMany({ where, skip: params.skip, take: params.take, orderBy: [{ key: params.dir }, { environment: "asc" }] }),
    prisma.featureFlag.count({ where }),
  ]);
  const active = isEnvironment(environment) ? environment : undefined;
  return (
    <>
      <PageHeader title="Feature flags" description="Toggle flags and set rollout per environment. Prod changes require a reason, are audited and post to Slack." />
      <nav aria-label="Environment" className="mb-4 flex gap-2 text-sm">
        {[undefined, ...ENVIRONMENTS].map((env) => (
          <Link
            key={env ?? "all"}
            href={hrefWith("/flags", sp, { environment: env, page: undefined })}
            className={env === active ? "rounded bg-slate-900 px-3 py-1 font-medium text-white" : "rounded px-3 py-1 text-slate-700 hover:bg-slate-100"}
          >
            {env ?? "All"}
          </Link>
        ))}
      </nav>
      <FilterBar
        basePath="/flags"
        searchParams={sp}
        fields={[
          { type: "select", name: "environment", label: "Environment", options: ENVIRONMENTS.map((e) => ({ value: e, label: e })) },
          { type: "text", name: "key", label: "Flag key (prefix)", placeholder: "instant-" },
        ]}
      />
      <DataTable columns={columns} rows={rows} rowKey={(f) => f.id} total={total} params={params} basePath="/flags" searchParams={sp} emptyMessage="No flags match." />
    </>
  );
}
