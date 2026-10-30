import { firstParam, type SearchParams } from "@fintech/platform";
import type { AuditFilters } from "@fintech/platform/server";

export const AUDIT_FILTER_KEYS = ["actor", "entityType", "entityId", "action", "from", "to"] as const;

function parseDate(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseAuditFilters(searchParams: SearchParams): AuditFilters {
  const get = (k: string) => firstParam(searchParams[k])?.trim() || undefined;
  return {
    actor: get("actor"),
    entityType: get("entityType"),
    entityId: get("entityId"),
    action: get("action"),
    from: parseDate(get("from"), false),
    to: parseDate(get("to"), true),
  };
}
