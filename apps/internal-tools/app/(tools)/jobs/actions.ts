"use server";

import { NotFoundError } from "@fintech/platform";
import { requireRole, runAction, runJob, type ActionResult } from "@fintech/platform/server";
import { revalidatePath } from "next/cache";
import { JOBS_ROLES } from "@/lib/catalog";
import { findJob } from "@/lib/jobs";

/** Admin "Run now". The run is recorded as a JobRun and audited (`job.run`) by `runJob`. */
export async function runJobNow(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async () => {
    const user = await requireRole(JOBS_ROLES);
    const job = findJob(String(formData.get("job") ?? ""));
    if (!job) throw new NotFoundError("Unknown job");
    const run = await runJob(job, { trigger: "manual", actor: user });
    revalidatePath("/jobs");
    return run;
  });
  if (!res.ok) return res;
  const run = res.data;
  return run.status === "SUCCEEDED"
    ? { ok: true, data: run.id, message: `${run.job} finished: ${JSON.stringify(run.result)}` }
    : { ok: false, error: `${run.job} failed (${run.error ?? "unknown error"})`, code: "job_failed" };
}
