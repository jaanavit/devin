import type { KycCase, Prisma, SessionUser } from "@fintech/models";
import { KYC_STATUSES, RISK_LEVELS } from "./rules";

export const KYC_FILTER_KEYS = ["status", "riskLevel", "assignee"] as const;
export const KYC_SORTABLE = ["slaDueAt", "openedAt", "riskLevel", "status"] as const;

const HOUR_MS = 3_600_000;

/** Builds the list query from URL filters. Unknown values are ignored rather than trusted. */
export function kycWhere(filters: Record<string, string>, viewer: Pick<SessionUser, "id">): Prisma.KycCaseWhereInput {
  const where: Prisma.KycCaseWhereInput = {};
  const status = KYC_STATUSES.find((s) => s === filters.status);
  const riskLevel = RISK_LEVELS.find((r) => r === filters.riskLevel);
  if (status) where.status = status;
  if (riskLevel) where.riskLevel = riskLevel;
  if (filters.assignee === "me") where.assigneeId = viewer.id;
  else if (filters.assignee === "unassigned") where.assigneeId = null;
  else if (filters.assignee) where.assigneeId = filters.assignee;
  return where;
}

export function formatDuration(ms: number): string {
  const hours = Math.floor(Math.max(0, ms) / HOUR_MS);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export interface SlaInfo {
  age: string;
  overdue: boolean;
  label: string;
}

/** SLA age since the case opened, and whether an undecided case is past its due time. */
export function slaInfo(c: Pick<KycCase, "openedAt" | "slaDueAt" | "status">, now: Date = new Date()): SlaInfo {
  const age = formatDuration(now.getTime() - c.openedAt.getTime());
  if (c.status === "APPROVED" || c.status === "REJECTED") return { age, overdue: false, label: "Closed" };
  const remaining = c.slaDueAt.getTime() - now.getTime();
  return remaining < 0
    ? { age, overdue: true, label: `${formatDuration(-remaining)} overdue` }
    : { age, overdue: false, label: `Due in ${formatDuration(remaining)}` };
}
