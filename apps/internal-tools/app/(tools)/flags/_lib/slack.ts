import { notify } from "@fintech/platform/server";
import { slackText, type FlagAuditAction, type FlagSnapshot } from "./rules";

/**
 * Posts a prod flag change to Slack via the platform `notify()`. Called after the change has
 * committed; `notify()` never throws, so a Slack failure never rolls back or fails the change.
 */
export async function postProdFlagChange(change: {
  action: FlagAuditAction;
  before: FlagSnapshot;
  after: FlagSnapshot;
  actorEmail: string;
  reason: string | null;
}): Promise<void> {
  await notify({ event: change.action, entity: { type: "prod flag", id: change.after.key }, text: slackText(change) });
}
