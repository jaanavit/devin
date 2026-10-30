// Server-only side effects for refunds: payments-mock calls and the Slack alert.
import { prisma, type Refund, type SessionUser } from "@fintech/models";
import { PlatformError } from "@fintech/platform";
import { audit, inTransaction, notify, paymentsClient } from "@fintech/platform/server";
import { isLargeRefund, largeRefundAlertText, transactionStatusAfterRefunds } from "./policy";

export type ProcessOutcome = "processed" | "failed" | "skipped";

const PROCESSABLE = ["APPROVED", "FAILED"] as const;

/**
 * Sends an approved (or previously failed) refund to payments-mock via `POST /refunds` and records
 * the outcome. Safe to retry: payments-mock is idempotent on `refundId`, and the status update is
 * conditional so concurrent retries cannot double-apply.
 */
export async function processRefund(actor: SessionUser, refundId: string): Promise<ProcessOutcome> {
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund || !(PROCESSABLE as readonly string[]).includes(refund.status)) return "skipped";

  let externalRefundId: string;
  try {
    ({ externalRefundId } = await paymentsClient().createRefund({ refundId: refund.id, transactionId: refund.transactionId, amountCents: refund.amountCents }));
  } catch (err) {
    const code = err instanceof PlatformError ? err.code : "payments_unreachable";
    console.warn(`refund ${refund.id}: payments call failed (${code})`);
    await inTransaction(prisma, async (tx) => {
      const { count } = await tx.refund.updateMany({ where: { id: refund.id, status: { in: [...PROCESSABLE] } }, data: { status: "FAILED" } });
      if (count !== 1) return;
      const after = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
      await audit(actor, { action: "refund.process_fail", entityType: "Refund", entityId: refund.id, before: refund, after, metadata: { error: code } }, tx);
    });
    return "failed";
  }

  await inTransaction(prisma, async (tx) => {
    const { count } = await tx.refund.updateMany({
      where: { id: refund.id, status: { in: [...PROCESSABLE] } },
      data: { status: "PROCESSED", externalRefundId, processedAt: new Date() },
    });
    if (count !== 1) return; // a concurrent retry already recorded it (payments-mock replayed the same id)
    const after = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
    await audit(actor, { action: "refund.process", entityType: "Refund", entityId: refund.id, before: refund, after, metadata: { externalRefundId } }, tx);

    await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${refund.transactionId} FOR UPDATE`;
    const txn = await tx.transaction.findUniqueOrThrow({ where: { id: refund.transactionId }, select: { id: true, status: true, amountCents: true } });
    const { _sum } = await tx.refund.aggregate({ where: { transactionId: txn.id, status: "PROCESSED" }, _sum: { amountCents: true } });
    const status = transactionStatusAfterRefunds(txn.amountCents, _sum.amountCents ?? 0);
    if (status !== txn.status) {
      await tx.transaction.update({ where: { id: txn.id }, data: { status } });
      await audit(
        actor,
        { action: "transaction.refund_status", entityType: "Transaction", entityId: txn.id, before: { status: txn.status }, after: { status }, metadata: { refundId: refund.id } },
        tx,
      );
    }
  });
  return "processed";
}

export type AlertOutcome = "sent" | "stubbed" | "failed" | "not_needed";

/**
 * Posts a Slack alert for refunds over $2,000 via the platform `notify()` (stubbed when
 * SLACK_WEBHOOK_URL is empty). Failures never block the refund.
 */
export async function alertLargeRefund(refund: Pick<Refund, "id" | "transactionId" | "amountCents">): Promise<AlertOutcome> {
  if (!isLargeRefund(refund.amountCents)) return "not_needed";
  return notify({ event: "refund.large_alert", entity: { type: "refund", id: refund.id }, text: largeRefundAlertText(refund) });
}
