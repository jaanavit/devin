// Scheduler process: runs due jobs every minute.  pnpm jobs:worker
import "dotenv/config";
import { prisma } from "@fintech/models";
import { describeSchedule, startScheduler } from "@fintech/platform/server";
import { JOBS } from "../apps/internal-tools/lib/jobs";

for (const job of JOBS) console.log(`scheduled: ${job.name} (${describeSchedule(job.schedule)})`);
const stop = startScheduler(JOBS);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stop();
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
