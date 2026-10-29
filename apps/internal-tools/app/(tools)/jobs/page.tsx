import { prisma, type JobRun } from "@fintech/models";
import { describeSchedule, lastRuns, nextRunAt, requirePageRole } from "@fintech/platform/server";
import { Badge, Card, Form, PageHeader, type BadgeTone } from "@fintech/platform/ui";
import { JOBS_ROLES } from "@/lib/catalog";
import { JOBS } from "@/lib/jobs";
import { runJobNow } from "./actions";

const ts = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
const TONE: Record<JobRun["status"], BadgeTone> = { RUNNING: "info", SUCCEEDED: "success", FAILED: "danger" };

export default async function JobsPage() {
  await requirePageRole(JOBS_ROLES);
  const now = new Date();
  const [last, recent] = await Promise.all([lastRuns(JOBS.map((j) => j.name)), prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 25 })]);
  return (
    <>
      <PageHeader title="Scheduled jobs" description="The scheduler (pnpm jobs:worker) runs these automatically. Manual runs are recorded and audited." />
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {JOBS.map((job) => {
          const lastRun = last.get(job.name);
          return (
            <Card key={job.name} className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-mono text-sm font-semibold">{job.name}</h2>
                <span className="text-xs text-slate-500">{describeSchedule(job.schedule)}</span>
              </div>
              <p className="text-sm text-slate-600">{job.description}</p>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-slate-500">Last run</dt>
                  <dd>{lastRun ? <><Badge tone={TONE[lastRun.status]}>{lastRun.status}</Badge> {ts(lastRun.startedAt)}</> : "never"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Next scheduled</dt>
                  <dd>{ts(nextRunAt(job.schedule, lastRun?.startedAt ?? null, now))}</dd>
                </div>
              </dl>
              <Form action={runJobNow} submitLabel="Run now" variant="secondary">
                <input type="hidden" name="job" value={job.name} />
              </Form>
            </Card>
          );
        })}
      </div>
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent runs</h2>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-4 font-medium">Started</th>
              <th className="py-1 pr-4 font-medium">Job</th>
              <th className="py-1 pr-4 font-medium">Trigger</th>
              <th className="py-1 pr-4 font-medium">By</th>
              <th className="py-1 pr-4 font-medium">Status</th>
              <th className="py-1 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recent.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-4 whitespace-nowrap">{ts(r.startedAt)}</td>
                <td className="py-2 pr-4 font-mono text-xs">{r.job}</td>
                <td className="py-2 pr-4">{r.trigger}</td>
                <td className="py-2 pr-4 text-xs">{r.actorId}</td>
                <td className="py-2 pr-4"><Badge tone={TONE[r.status]}>{r.status}</Badge></td>
                <td className="py-2 font-mono text-xs text-slate-600">{r.error ?? (r.result ? JSON.stringify(r.result) : "")}</td>
              </tr>
            ))}
            {recent.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-500">No runs yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </>
  );
}
