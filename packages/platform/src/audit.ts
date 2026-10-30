import { Prisma, prisma, type Actor, type AuditLog } from "@fintech/models";
import { toCsv } from "./csv";
import type { DbClient } from "./db";
import { redactPii } from "./mask";

export interface AuditEntry {
  /** Dotted, past-tense-free verb: e.g. "kyc_case.claim", "refund.request", "pii.view". */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  return redactPii(value) as Prisma.InputJsonValue;
}

/**
 * Appends a row to the audit log. PII-named keys in before/after/metadata are redacted.
 * Pass the transaction client as `db` so the audit row commits atomically with the mutation.
 * There is deliberately no update/delete API; the table is append-only at the database level.
 */
export async function audit(actor: Actor, entry: AuditEntry, db: DbClient = prisma): Promise<AuditLog> {
  return db.auditLog.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: toJson(entry.before),
      after: toJson(entry.after),
      metadata: toJson(entry.metadata),
    },
  });
}

export interface AuditFilters {
  actor?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

export function auditWhere(f: AuditFilters): Prisma.AuditLogWhereInput {
  return {
    ...(f.actor ? { OR: [{ actorId: f.actor }, { actorEmail: { contains: f.actor, mode: "insensitive" } }] } : {}),
    ...(f.entityType ? { entityType: f.entityType } : {}),
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
}

export async function queryAuditLogs(
  filters: AuditFilters,
  page: { skip: number; take: number; orderBy?: Prisma.AuditLogOrderByWithRelationInput },
): Promise<{ rows: AuditLog[]; total: number }> {
  const where = auditWhere(filters);
  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({ where, skip: page.skip, take: page.take, orderBy: page.orderBy ?? { createdAt: "desc" } }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total };
}

export const AUDIT_EXPORT_LIMIT = 50_000;

export function auditLogsToCsv(rows: readonly AuditLog[]): string {
  return toCsv(rows, [
    { header: "timestamp", value: (r) => r.createdAt },
    { header: "actor_id", value: (r) => r.actorId },
    { header: "actor_email", value: (r) => r.actorEmail },
    { header: "action", value: (r) => r.action },
    { header: "entity_type", value: (r) => r.entityType },
    { header: "entity_id", value: (r) => r.entityId },
    { header: "before", value: (r) => r.before },
    { header: "after", value: (r) => r.after },
    { header: "metadata", value: (r) => r.metadata },
  ]);
}
