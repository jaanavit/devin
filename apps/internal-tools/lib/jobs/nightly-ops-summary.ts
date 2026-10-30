// Nightly Slack summary of KYC cases past SLA and refunds awaiting approval.
// No "@/" imports: also loaded by scripts/jobs-*.ts outside Next.js.
import { prisma } from "@fintech/models";
import { formatCents } from "@fintech/platform";
import { formatAge, notify, type JobDefinition } from "@fintech/platform/server";

export const SUMMARY_TOP_N = 10;
const OPEN_KYC_STATUSES = ["OPEN", "IN_REVIEW", "RECOMMENDED"] as const;

export interface OpsSummary {
  kycOverdue: { total: number; byRisk: Record<string, number>; oldest: { id: string; riskLevel: string; overdueMs: number }[] };
  refundsPending: { total: number; totalCents: number; oldest: { id: string; amountCents: number; waitingMs: number }[] };
}

export async function collectOpsSummary(now: Date): Promise<OpsSummary> {
  const overdueWhere = { status: { in: [...OPEN_KYC_STATUSES] }, slaDueAt: { lt: now } };
  const [kycTotal, kycByRisk, kycOldest, refundAgg, refundOldest] = await Promise.all([
    prisma.kycCase.count({ where: overdueWhere }),
    prisma.kycCase.groupBy({ by: ["riskLevel"], where: overdueWhere, _count: { _all: true } }),
    prisma.kycCase.findMany({ where: overdueWhere, orderBy: { slaDueAt: "asc" }, take: SUMMARY_TOP_N, select: { id: true, riskLevel: true, slaDueAt: true } }),
    prisma.refund.aggregate({ where: { status: "PENDING_APPROVAL" }, _count: { _all: true }, _sum: { amountCents: true } }),
    prisma.refund.findMany({ where: { status: "PENDING_APPROVAL" }, orderBy: { createdAt: "asc" }, take: SUMMARY_TOP_N, select: { id: true, amountCents: true, createdAt: true } }),
  ]);
  return {
    kycOverdue: {
      total: kycTotal,
      byRisk: Object.fromEntries(kycByRisk.map((g) => [g.riskLevel, g._count._all])),
      oldest: kycOldest.map((k) => ({ id: k.id, riskLevel: k.riskLevel, overdueMs: now.getTime() - k.slaDueAt.getTime() })),
    },
    refundsPending: {
      total: refundAgg._count._all,
      totalCents: refundAgg._sum.amountCents ?? 0,
      oldest: refundOldest.map((r) => ({ id: r.id, amountCents: r.amountCents, waitingMs: now.getTime() - r.createdAt.getTime() })),
    },
  };
}

/** Slack text: IDs, risk levels, amounts and ages only (no customer data). */
export function summaryText(s: OpsSummary, now: Date, baseUrl?: string): string {
  const link = (path: string, label: string) => (baseUrl ? `<${baseUrl}${path}|${label}>` : label);
  const risk = ["HIGH", "MEDIUM", "LOW"].filter((r) => s.kycOverdue.byRisk[r]).map((r) => `${r.toLowerCase()} ${s.kycOverdue.byRisk[r]}`).join(", ");
  const lines = [
    `:clipboard: Nightly ops summary (${now.toISOString().slice(0, 10)})`,
    `*KYC cases past SLA:* ${s.kycOverdue.total}${risk ? ` (${risk})` : ""}`,
    ...s.kycOverdue.oldest.map((k) => `  • ${link(`/kyc/${k.id}`, k.id)} ${k.riskLevel.toLowerCase()} risk, ${formatAge(k.overdueMs)} overdue`),
    `*Refunds awaiting approval:* ${s.refundsPending.total} totalling ${formatCents(s.refundsPending.totalCents)}`,
    ...s.refundsPending.oldest.map((r) => `  • ${link(`/refunds/${r.id}`, r.id)} ${formatCents(r.amountCents)}, waiting ${formatAge(r.waitingMs)}`),
  ];
  if (s.kycOverdue.total > SUMMARY_TOP_N || s.refundsPending.total > SUMMARY_TOP_N) lines.push(`_(showing the ${SUMMARY_TOP_N} oldest of each)_`);
  return lines.join("\n");
}

export const nightlyOpsSummaryJob: JobDefinition = {
  name: "nightly-ops-summary",
  description: "Slack summary of KYC cases past SLA and refunds awaiting approval.",
  schedule: { dailyAtUtc: "02:00" },
  async run({ now }) {
    const summary = await collectOpsSummary(now);
    const outcome = await notify({ event: "ops.nightly_summary", entity: { type: "summary", id: now.toISOString().slice(0, 10) }, text: summaryText(summary, now, process.env.NEXTAUTH_URL) });
    return { kycOverdue: summary.kycOverdue.total, refundsPending: summary.refundsPending.total, refundsPendingCents: summary.refundsPending.totalCents, notify: outcome };
  },
};
