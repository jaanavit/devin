import { prisma } from "@fintech/models";
import { audit } from "./audit";
import type { JobDefinition } from "./jobs";
import { formatCents } from "./money";
import { notify } from "./notify";

/** First reminder once a request has waited this long, then at most once per REMIND_AGAIN_MS. */
export const REMIND_AFTER_MS = 60 * 60 * 1000;
export const REMIND_AGAIN_MS = 24 * 60 * 60 * 1000;
export const REMINDER_BATCH = 50;

export function formatAge(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Job: notify when approval requests have been PENDING for more than an hour. One Slack digest per
 * run; each included request gets `lastReminderAt` set (conditional update, so concurrent runs can't
 * double-remind) and an `approval.remind` audit row. `linkFor` lets the app add deep links.
 */
export function approvalRemindersJob(opts: { linkFor?: (kind: string, entityId: string) => string | undefined } = {}): JobDefinition {
  return {
    name: "approval-reminders",
    description: "Slack reminder for approval requests waiting more than 1 hour (repeats at most daily per request).",
    schedule: { everyMinutes: 15 },
    async run({ now, actor }) {
      const due = await prisma.approvalRequest.findMany({
        where: {
          status: "PENDING",
          createdAt: { lte: new Date(now.getTime() - REMIND_AFTER_MS) },
          OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: new Date(now.getTime() - REMIND_AGAIN_MS) } }],
        },
        orderBy: { createdAt: "asc" },
        take: REMINDER_BATCH,
      });
      const reminded: typeof due = [];
      for (const r of due) {
        const { count } = await prisma.approvalRequest.updateMany({
          where: { id: r.id, status: "PENDING", lastReminderAt: r.lastReminderAt },
          data: { lastReminderAt: now },
        });
        if (count !== 1) continue;
        await audit(actor, { action: "approval.remind", entityType: "ApprovalRequest", entityId: r.id, metadata: { kind: r.kind, waitedMs: now.getTime() - r.createdAt.getTime() } });
        reminded.push(r);
      }
      if (reminded.length === 0) return { reminded: 0 };
      const lines = reminded.map((r) => {
        const amount = r.amountCents !== null ? ` ${formatCents(r.amountCents)}` : "";
        const link = opts.linkFor?.(r.kind, r.entityId);
        return `• ${r.kind} ${r.entityType} ${r.entityId}${amount}: waiting ${formatAge(now.getTime() - r.createdAt.getTime())} for ${r.approverRoles.join("/")}${link ? ` <${link}|open>` : ""}`;
      });
      const outcome = await notify({
        event: "approval.reminder",
        entity: { type: "approvals", id: String(reminded.length) },
        text: [`:hourglass_flowing_sand: ${reminded.length} approval request(s) waiting more than 1 hour`, ...lines].join("\n"),
      });
      return { reminded: reminded.length, approvalRequestIds: reminded.map((r) => r.id), notify: outcome };
    },
  };
}
