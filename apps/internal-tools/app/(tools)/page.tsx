import { hasAnyRole } from "@fintech/platform";
import { requirePageRole } from "@fintech/platform/server";
import { Badge, Card, PageHeader } from "@fintech/platform/ui";
import Link from "next/link";
import { CATALOG_ROLES, TOOLS } from "@/lib/catalog";

export default async function CatalogPage() {
  const user = await requirePageRole(CATALOG_ROLES);
  return (
    <>
      <PageHeader title="App catalog" description="Every internal tool on the platform, who owns it, and who can use it." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {TOOLS.map((tool) => {
          const allowed = hasAnyRole(user, tool.roles);
          return (
            <Card key={tool.slug} className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">
                  {allowed ? (
                    <Link href={tool.href} className="hover:underline">
                      {tool.name}
                    </Link>
                  ) : (
                    tool.name
                  )}
                </h2>
                {tool.lifecycle === "short-lived" ? <Badge tone="warning">Short-lived</Badge> : null}
              </div>
              <p className="text-sm text-slate-600">{tool.description}</p>
              <dl className="mt-auto grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-slate-500">Owner</dt>
                  <dd>{tool.owner}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Allowed roles</dt>
                  <dd className="flex flex-wrap gap-1">
                    {tool.roles.map((r) => (
                      <Badge key={r}>{r}</Badge>
                    ))}
                  </dd>
                </div>
              </dl>
              {!allowed ? <p className="text-xs text-slate-500">You do not have access to this tool.</p> : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
