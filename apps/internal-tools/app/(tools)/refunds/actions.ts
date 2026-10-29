"use server";

import { prisma, type Refund } from "@fintech/models";
import { ConflictError, NotFoundError, ValidationError, parseDollarsToCents } from "@fintech/platform";
import {
  approveRequest,
  audit,
  createApprovalRequest,
  inTransaction,
  isApproved,
  rejectRequest,
  requireRole,
  runAction,
  type ActionResult,
} from "@fintech/platform/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { REFUND_APPROVER_ROLES, REFUND_REQUESTER_ROLES, REFUNDS_ROLES } from "@/lib/catalog";
import { REFUND_POLICY, validateRefundRequest } from "./_lib/policy";
import { alertLargeRefund, processRefund, type ProcessOutcome } from "./_lib/process";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

function outcomeMessage(prefix: string, outcome: ProcessOutcome): string {
  if (outcome === "processed") return `${prefix} and sent to payments.`;
  if (outcome === "failed") return `${prefix}, but the payments call failed. Retry from the refund page.`;
  return `${prefix}.`;
}

function withMessage(res: ActionResult<ProcessOutcome>, prefix: string): ActionResult<ProcessOutcome> {
  return res.ok ? { ...res, message: outcomeMessage(prefix, res.data) } : res;
}

/** Analyst creates a refund request. <= $500 auto-approves and is sent to payments immediately. */
export async function createRefund(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async (): Promise<Refund> => {
    const user = await requireRole(REFUND_REQUESTER_ROLES);
    const transactionId = field(formData, "transactionId");
    const reason = field(formData, "reason");
    const amountCents = parseDollarsToCents(field(formData, "amount"));
    if (!transactionId) throw new ValidationError("A transaction is required", "transaction_required");

    const refund = await inTransaction(prisma, async (tx) => {
      // Lock the transaction row so concurrent requests cannot over-refund it.
      await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${transactionId} FOR UPDATE`;
      const txn = await tx.transaction.findUnique({
        where: { id: transactionId },
        select: { id: true, customerId: true, status: true, amountCents: true, refunds: { select: { amountCents: true, status: true } } },
      });
      if (!txn) throw new NotFoundError("Transaction not found");
      const amount = validateRefundRequest({ amountCents, reason, txn, existing: txn.refunds });
      const created = await tx.refund.create({
        data: { transactionId: txn.id, customerId: txn.customerId, amountCents: amount, reason, status: "PENDING_APPROVAL", requestedById: user.id },
      });
      const approval = await createApprovalRequest({ policy: REFUND_POLICY, entityId: created.id, amountCents: amount, requester: user }, tx);
      const after = await tx.refund.update({
        where: { id: created.id },
        data: { approvalRequestId: approval.id, status: isApproved(approval) ? "APPROVED" : "PENDING_APPROVAL" },
      });
      await audit(user, { action: "refund.create", entityType: "Refund", entityId: after.id, after, metadata: { approvalRequestId: approval.id, approvalStatus: approval.status } }, tx);
      return after;
    });

    await alertLargeRefund(refund);
    if (refund.status === "APPROVED") await processRefund(user, refund.id);
    revalidatePath("/refunds");
    return refund;
  });
  if (res.ok) redirect(`/refunds/${res.data.id}`);
  return res;
}

/** Reviewer approves a pending refund (never their own), then it is sent to payments. */
export async function approveRefund(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async () => {
    const user = await requireRole(REFUND_APPROVER_ROLES);
    const id = field(formData, "id");
    const note = field(formData, "note") || undefined;
    await inTransaction(prisma, async (tx) => {
      const before = await tx.refund.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Refund not found");
      if (before.status !== "PENDING_APPROVAL" || !before.approvalRequestId) throw new ConflictError(`Refund is ${before.status}`, "not_pending");
      await approveRequest({ requestId: before.approvalRequestId, approver: user, reason: note }, tx);
      const { count } = await tx.refund.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "APPROVED" } });
      if (count !== 1) throw new ConflictError("Refund was decided by someone else", "not_pending");
      const after = await tx.refund.findUniqueOrThrow({ where: { id } });
      await audit(user, { action: "refund.approve", entityType: "Refund", entityId: id, before, after }, tx);
    });
    const outcome = await processRefund(user, id);
    revalidatePath("/refunds");
    revalidatePath(`/refunds/${id}`);
    return outcome;
  });
  return withMessage(res, "Refund approved");
}

/** Reviewer rejects a pending refund with a required reason. */
export async function rejectRefund(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const user = await requireRole(REFUND_APPROVER_ROLES);
    const id = field(formData, "id");
    const reason = field(formData, "reason");
    await inTransaction(prisma, async (tx) => {
      const before = await tx.refund.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Refund not found");
      if (before.status !== "PENDING_APPROVAL" || !before.approvalRequestId) throw new ConflictError(`Refund is ${before.status}`, "not_pending");
      await rejectRequest({ requestId: before.approvalRequestId, approver: user, reason }, tx);
      const { count } = await tx.refund.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "REJECTED" } });
      if (count !== 1) throw new ConflictError("Refund was decided by someone else", "not_pending");
      const after = await tx.refund.findUniqueOrThrow({ where: { id } });
      await audit(user, { action: "refund.reject", entityType: "Refund", entityId: id, before, after, metadata: { reason } }, tx);
    });
    revalidatePath("/refunds");
    revalidatePath(`/refunds/${id}`);
  }, "Refund rejected.");
}

/** Re-sends a refund whose payments call failed. Idempotent on the payments side. */
export async function retryRefund(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async () => {
    const user = await requireRole(REFUNDS_ROLES);
    const id = field(formData, "id");
    const refund = await prisma.refund.findUnique({ where: { id }, select: { status: true } });
    if (!refund) throw new NotFoundError("Refund not found");
    if (refund.status !== "FAILED") throw new ConflictError(`Only failed refunds can be retried (this one is ${refund.status})`, "not_failed");
    const outcome = await processRefund(user, id);
    revalidatePath(`/refunds/${id}`);
    return outcome;
  });
  return withMessage(res, "Retry finished");
}
