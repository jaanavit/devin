"use server";

import { prisma, type SessionUser } from "@fintech/models";
import { ConflictError, NotFoundError, ValidationError } from "@fintech/platform";
import { audit, inTransaction, requireRole, runAction, type ActionResult } from "@fintech/platform/server";
import { revalidatePath } from "next/cache";
import { FLAGS_ROLES } from "@/lib/catalog";
import { parseEnabled, parseReason, parseRollout, snapshot, type FlagAuditAction, type FlagSnapshot } from "./_lib/rules";
import { postProdFlagChange } from "./_lib/slack";

type FlagChange = Partial<Pick<FlagSnapshot, "enabled" | "rolloutPercentage">>;

/**
 * Loads the flag, validates the reason for its environment, applies `compute(before)` with a
 * compare-and-set on the current values, and audits before/after in the same transaction.
 * Prod changes are posted to Slack after commit.
 */
async function applyChange(user: SessionUser, formData: FormData, action: FlagAuditAction, compute: (before: FlagSnapshot) => FlagChange) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new ValidationError("Missing flag id");
  const result = await inTransaction(prisma, async (tx) => {
    const current = await tx.featureFlag.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("Flag not found");
    const before = snapshot(current);
    const reason = parseReason(before.environment, formData.get("reason"));
    const data = compute(before);
    const { count } = await tx.featureFlag.updateMany({
      where: { id, enabled: before.enabled, rolloutPercentage: before.rolloutPercentage },
      data: { ...data, updatedById: user.id },
    });
    if (count !== 1) throw new ConflictError("The flag was changed by someone else; reload and try again");
    const after = snapshot(await tx.featureFlag.findUniqueOrThrow({ where: { id } }));
    await audit(user, { action, entityType: "FeatureFlag", entityId: id, before, after, metadata: { environment: before.environment, key: before.key, reason } }, tx);
    return { before, after, reason };
  });
  if (result.after.environment === "prod") await postProdFlagChange({ action, ...result, actorEmail: user.email });
  revalidatePath("/flags");
  revalidatePath(`/flags/${id}`);
}

export async function toggleFlag(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireRole(FLAGS_ROLES);
    const enabled = parseEnabled(formData.get("enabled"));
    await applyChange(user, formData, "feature_flag.toggle", (before) => {
      if (before.enabled === enabled) throw new ConflictError(`The flag is already ${enabled ? "on" : "off"}`);
      return { enabled };
    });
  }, "Flag updated.");
}

export async function setRollout(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireRole(FLAGS_ROLES);
    const rolloutPercentage = parseRollout(formData.get("rolloutPercentage"));
    await applyChange(user, formData, "feature_flag.set_rollout", (before) => {
      if (before.rolloutPercentage === rolloutPercentage) throw new ValidationError(`Rollout is already ${rolloutPercentage}%`, "no_change");
      return { rolloutPercentage };
    });
  }, "Rollout updated.");
}
