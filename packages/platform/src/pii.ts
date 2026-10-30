import { prisma, type SessionUser } from "@fintech/models";
import { audit } from "./audit";
import type { DbClient } from "./db";
import { isPiiField, mask, type Masked } from "./mask";
import { canViewPii } from "./rbac";

/**
 * Masks `record` for `viewer`. When the viewer is allowed to see PII and the record contains
 * PII fields, the reveal is audited as `pii.view` (field names only; never values).
 */
export async function maskForViewer<T extends object>(
  viewer: SessionUser,
  record: T,
  subject: { entityType: string; entityId: string },
  db: DbClient = prisma,
): Promise<Masked<T>> {
  const fields = Object.keys(record).filter(isPiiField);
  if (canViewPii(viewer) && fields.length > 0) {
    await audit(viewer, { action: "pii.view", ...subject, metadata: { fields } }, db);
  }
  return mask(record, viewer);
}
