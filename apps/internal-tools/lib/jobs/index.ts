// Registry of scheduled jobs. Used by the /jobs admin page (manual trigger) and by
// scripts/jobs-worker.ts (scheduler) and scripts/jobs-run.ts (CLI trigger).
import { approvalRemindersJob, type JobDefinition } from "@fintech/platform/server";
import { nightlyOpsSummaryJob } from "./nightly-ops-summary";

const APPROVAL_LINKS: Record<string, (id: string) => string> = {
  refund: (id) => `/refunds/${id}`,
  kyc_decision: (id) => `/kyc/${id}`,
};

export const JOBS: readonly JobDefinition[] = [
  approvalRemindersJob({
    linkFor: (kind, entityId) => {
      const path = APPROVAL_LINKS[kind]?.(entityId);
      return path && process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL}${path}` : undefined;
    },
  }),
  nightlyOpsSummaryJob,
];

export function findJob(name: string): JobDefinition | undefined {
  return JOBS.find((j) => j.name === name);
}
