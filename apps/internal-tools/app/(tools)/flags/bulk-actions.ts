"use server";

import { prisma } from "@fintech/models";
import { requireRole, runAction, type ActionResult } from "@fintech/platform/server";
import { FLAGS_ROLES } from "@/lib/catalog";

/**
 * DELIBERATE POLICY VIOLATION (do not merge): turns off every flag in an environment
 * but never calls audit(). CI must fail with POLICY-1 audit-on-write.
 */
export async function disableAllFlags(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await requireRole(FLAGS_ROLES);
    const environment = String(formData.get("environment") ?? "dev") as "dev" | "staging" | "prod";
    const { count } = await prisma.featureFlag.updateMany({ where: { environment }, data: { enabled: false } });
    return count;
  });
}
