import { Prisma, prisma, type Actor, type JobRun, type SystemActor } from "@fintech/models";
import { audit } from "./audit";
import { ConflictError } from "./errors";
import { redactPii } from "./mask";

/** `everyMinutes`: run when the last run started at least N minutes ago. `dailyAtUtc`: once per day at "HH:MM" UTC. */
export type Schedule = { everyMinutes: number } | { dailyAtUtc: string };

export interface JobContext {
  now: Date;
  trigger: "schedule" | "manual";
  actor: Actor;
}

export interface JobDefinition {
  name: string;
  description: string;
  schedule: Schedule;
  /** Returns a small, non-PII summary that is stored on the JobRun and in the audit log. */
  run(ctx: JobContext): Promise<Record<string, unknown>>;
}

export const SYSTEM_SCHEDULER: SystemActor = { id: "system:scheduler", email: "scheduler@system" };

/** RUNNING rows older than this are treated as crashed and marked FAILED before a new run starts. */
export const STALE_RUN_MS = 60 * 60 * 1000;

export class JobAlreadyRunningError extends ConflictError {
  constructor(job: string) {
    super(`Job "${job}" is already running`, "job_running");
  }
}

function dailySlot(hhmm: string, now: Date): Date {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Invalid dailyAtUtc "${hhmm}" (expected HH:MM)`);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(m[1]), Number(m[2])));
}

/** Pure scheduling rule: is `schedule` due at `now`, given when the job last started? */
export function isDue(schedule: Schedule, lastStartedAt: Date | null, now: Date): boolean {
  if ("everyMinutes" in schedule) return !lastStartedAt || now.getTime() - lastStartedAt.getTime() >= schedule.everyMinutes * 60_000;
  const slot = dailySlot(schedule.dailyAtUtc, now);
  return now >= slot && (!lastStartedAt || lastStartedAt < slot);
}

/** Next time the job becomes due (for display). */
export function nextRunAt(schedule: Schedule, lastStartedAt: Date | null, now: Date): Date {
  if ("everyMinutes" in schedule) return lastStartedAt ? new Date(lastStartedAt.getTime() + schedule.everyMinutes * 60_000) : now;
  const slot = dailySlot(schedule.dailyAtUtc, now);
  return isDue(schedule, lastStartedAt, now) ? now : now < slot ? slot : new Date(slot.getTime() + 86_400_000);
}

export function describeSchedule(schedule: Schedule): string {
  return "everyMinutes" in schedule ? `every ${schedule.everyMinutes} min` : `daily at ${schedule.dailyAtUtc} UTC`;
}

/**
 * Runs `job` once and records it as a JobRun. At most one RUNNING run per job is allowed (DB partial
 * unique index), so concurrent triggers fail fast with `JobAlreadyRunningError`. The run is audited
 * as `job.run` with its trigger, status and summary. Failures are recorded (error class only, since
 * messages from the DB layer can contain row values) and re-thrown.
 */
export async function runJob(job: JobDefinition, opts: { trigger: JobContext["trigger"]; actor: Actor; now?: Date }): Promise<JobRun> {
  const now = opts.now ?? new Date();
  await prisma.jobRun.updateMany({
    where: { job: job.name, status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
    data: { status: "FAILED", finishedAt: now, error: "Stale: did not finish within the time limit" },
  });
  let run: JobRun;
  try {
    run = await prisma.jobRun.create({ data: { job: job.name, trigger: opts.trigger, actorId: opts.actor.id, startedAt: now } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new JobAlreadyRunningError(job.name);
    throw err;
  }
  let status: "SUCCEEDED" | "FAILED" = "SUCCEEDED";
  let result: Record<string, unknown> | undefined;
  let error: string | undefined;
  try {
    result = redactPii(await job.run({ now, trigger: opts.trigger, actor: opts.actor })) as Record<string, unknown>;
  } catch (err) {
    status = "FAILED";
    error = err instanceof Error ? err.name : "Error";
    console.error(`job ${job.name} failed: ${error}`);
  }
  const finished = await prisma.jobRun.update({
    where: { id: run.id },
    data: { status, finishedAt: new Date(), result: result ? (result as Prisma.InputJsonValue) : Prisma.DbNull, error: error ?? null },
  });
  await audit(opts.actor, { action: "job.run", entityType: "JobRun", entityId: run.id, after: finished, metadata: { job: job.name, trigger: opts.trigger, status } });
  return finished;
}

export async function lastRuns(names: readonly string[]): Promise<Map<string, JobRun>> {
  const rows = await prisma.jobRun.findMany({ where: { job: { in: [...names] } }, orderBy: { startedAt: "desc" }, distinct: ["job"] });
  return new Map(rows.map((r) => [r.job, r]));
}

/** Runs every job that is due at `now` (one at a time). Returns the names that ran. */
export async function runDueJobs(jobs: readonly JobDefinition[], now = new Date()): Promise<string[]> {
  const last = await lastRuns(jobs.map((j) => j.name));
  const ran: string[] = [];
  for (const job of jobs) {
    if (!isDue(job.schedule, last.get(job.name)?.startedAt ?? null, now)) continue;
    try {
      await runJob(job, { trigger: "schedule", actor: SYSTEM_SCHEDULER, now });
      ran.push(job.name);
    } catch (err) {
      if (!(err instanceof JobAlreadyRunningError)) console.error(`scheduler: ${job.name} errored: ${err instanceof Error ? err.name : typeof err}`);
    }
  }
  return ran;
}

/** Minimal in-process scheduler: checks for due jobs every `intervalMs`. Returns a stop function. */
export function startScheduler(jobs: readonly JobDefinition[], intervalMs = 60_000): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const ran = await runDueJobs(jobs);
      if (ran.length) console.info(`scheduler: ran ${ran.join(", ")}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
