import { outboundFetch } from "./outbound";

export interface Notification {
  /** Message text. Must not contain PII: use IDs, amounts, and work emails only. */
  text: string;
  /** Machine-readable event name, e.g. "refund.large_alert". Used in logs instead of the text. */
  event: string;
  /** What the notification is about. Logged (type + id only) when stubbed or on failure. */
  entity?: { type: string; id: string };
}

export type NotifyOutcome = "sent" | "stubbed" | "failed";

/**
 * Posts a notification to Slack (`SLACK_WEBHOOK_URL`) through the outbound allowlist.
 * Never throws: a notification failure must not undo or fail the business action that caused it.
 * When the webhook is not configured it logs a one-line stub (event + entity only, never the text).
 */
export async function notify(n: Notification): Promise<NotifyOutcome> {
  const ref = n.entity ? ` ${n.entity.type} ${n.entity.id}` : "";
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.info(`slack stub: ${n.event}${ref} (SLACK_WEBHOOK_URL not set)`);
    return "stubbed";
  }
  try {
    const res = await outboundFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: n.text }) });
    if (res.ok) return "sent";
    console.warn(`notify failed: ${n.event}${ref}: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`notify failed: ${n.event}${ref}: ${err instanceof Error ? err.name : typeof err}`);
  }
  return "failed";
}
