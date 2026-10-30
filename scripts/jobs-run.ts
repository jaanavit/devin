// Manually trigger one job from the command line:  pnpm jobs:run nightly-ops-summary
import "dotenv/config";
import { prisma } from "@fintech/models";
import { runJob } from "@fintech/platform/server";
import { JOBS, findJob } from "../apps/internal-tools/lib/jobs";

async function main(): Promise<void> {
  const name = process.argv[2] ?? "";
  const job = findJob(name);
  if (!job) {
    console.error(`Unknown job "${name}". Available: ${JOBS.map((j) => j.name).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const run = await runJob(job, { trigger: "manual", actor: { id: "system:cli", email: "cli@system" } });
  console.log(JSON.stringify({ job: run.job, status: run.status, result: run.result, error: run.error }, null, 2));
  if (run.status !== "SUCCEEDED") process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
