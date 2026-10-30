import { outboundFetch } from "@fintech/platform/server";
import { slackText, type FlagAuditAction, type FlagSnapshot } from "./rules";

// TODO(Phase 7): replace with notify() from @fintech/platform.
/**
 * Posts a prod flag change to Slack. Called after the change has committed, so a Slack failure is
 * logged (error class only) and never rolls back or fails the change. Skipped when unconfigured.
 */
export async function postProdFlagChange(change: {
  action: FlagAuditAction;
  before: FlagSnapshot;
  after: FlagSnapshot;
  actorEmail: string;
  reason: string | null;
}): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.info(`slack stub: ${change.action} on prod flag ${change.after.key} (SLACK_WEBHOOK_URL not set)`);
    return;
  }
  try {
    const res = await outboundFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: slackText(change) }),
    });
    if (!res.ok) console.error(`Slack webhook failed for ${change.action} on prod flag ${change.after.key}: HTTP ${res.status}`);
  } catch (err) {
    console.error(`Slack webhook failed for ${change.action} on prod flag ${change.after.key}:`, err instanceof Error ? err.name : typeof err);
  }
}
