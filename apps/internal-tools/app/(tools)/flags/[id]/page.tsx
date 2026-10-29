import { prisma } from "@fintech/models";
import { queryAuditLogs, requirePageRole } from "@fintech/platform/server";
import { Card, DetailView, Field, Form, Input, Notice, PageHeader, Textarea } from "@fintech/platform/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FLAGS_ROLES } from "@/lib/catalog";
import { setRollout, toggleFlag } from "../actions";
import { EnvironmentBadge, StatusBadge } from "../_lib/badges";
import { REASON_MAX_LENGTH } from "../_lib/rules";

const HISTORY_LIMIT = 20;

function ReasonField({ id, required }: { id: string; required: boolean }) {
  return (
    <Field label={required ? "Reason (required for prod)" : "Reason (optional)"} htmlFor={id}>
      <Textarea id={id} name="reason" required={required} maxLength={REASON_MAX_LENGTH} />
    </Field>
  );
}

export default async function FlagDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageRole(FLAGS_ROLES);
  const { id } = await params;
  const flag = await prisma.featureFlag.findUnique({ where: { id } });
  if (!flag) notFound();
  const isProd = flag.environment === "prod";
  const [{ rows: history }, updatedBy] = await Promise.all([
    queryAuditLogs({ entityType: "FeatureFlag", entityId: id }, { skip: 0, take: HISTORY_LIMIT }),
    flag.updatedById ? prisma.user.findUnique({ where: { id: flag.updatedById }, select: { email: true } }) : null,
  ]);

  return (
    <>
      <PageHeader
        title={flag.key}
        description={flag.description}
        actions={
          <Link href={`/flags?key=${encodeURIComponent(flag.key)}`} className="text-sm text-slate-600 hover:underline">
            All environments for this flag
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <DetailView
          sections={[
            {
              title: "Current state",
              aside: <EnvironmentBadge environment={flag.environment} />,
              fields: [
                { label: "Status", value: <StatusBadge enabled={flag.enabled} /> },
                { label: "Rollout", value: `${flag.rolloutPercentage}%` },
                { label: "Last updated (UTC)", value: `${flag.updatedAt.toISOString().replace("T", " ").slice(0, 16)}${updatedBy ? ` by ${updatedBy.email}` : ""}` },
              ],
            },
          ]}
        />
        {isProd ? <Notice tone="warning">This is a prod flag. Every change requires a reason, is audited, and is posted to Slack.</Notice> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{flag.enabled ? "Turn off" : "Turn on"}</h2>
            <Form action={toggleFlag} submitLabel={flag.enabled ? "Turn off" : "Turn on"} variant={flag.enabled ? "destructive" : "default"}>
              <input type="hidden" name="id" value={flag.id} />
              <input type="hidden" name="enabled" value={String(!flag.enabled)} />
              <ReasonField id="toggle-reason" required={isProd} />
            </Form>
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Rollout percentage</h2>
            <Form action={setRollout} submitLabel="Set rollout">
              <input type="hidden" name="id" value={flag.id} />
              <Field label="Percentage of users (0–100)" htmlFor="rollout" hint="Applies only while the flag is on.">
                <Input id="rollout" name="rolloutPercentage" type="number" min={0} max={100} step={1} required defaultValue={flag.rolloutPercentage} />
              </Field>
              <ReasonField id="rollout-reason" required={isProd} />
            </Form>
          </Card>
        </div>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Change history</h2>
            <Link href={`/audit?entityType=FeatureFlag&entityId=${flag.id}`} className="text-sm text-slate-600 hover:underline">
              Open in audit log
            </Link>
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">No changes recorded.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {history.map((h) => (
                <li key={h.id} className="py-2">
                  <span className="text-slate-500">{h.createdAt.toISOString().replace("T", " ").slice(0, 16)}</span> · {h.actorEmail} · <code className="text-xs">{h.action}</code>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify({ before: h.before, after: h.after, metadata: h.metadata }, null, 2)}</pre>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
