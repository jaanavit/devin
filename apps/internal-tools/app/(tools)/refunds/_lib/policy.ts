import type { RefundStatus, TransactionStatus } from "@fintech/models";
import { ValidationError, formatCents } from "@fintech/platform";
import type { ApprovalPolicy } from "@fintech/platform/server";
import type { BadgeTone } from "@fintech/platform/ui";
import { REFUND_APPROVER_ROLES } from "@/lib/catalog";

/** Refunds at or below $500 auto-approve; above that a Reviewer (not the requester) must approve. */
export const REFUND_POLICY: ApprovalPolicy = {
  kind: "refund",
  entityType: "Refund",
  approverRoles: REFUND_APPROVER_ROLES,
  autoApproveMaxCents: 50_000,
};

/** Refunds strictly above this amount post a Slack alert when requested. */
export const LARGE_REFUND_ALERT_CENTS = 200_000;

export const REFUND_STATUSES = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "PROCESSED", "FAILED"] as const satisfies readonly RefundStatus[];

export const REFUND_STATUS_TONE: Record<RefundStatus, BadgeTone> = {
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  REJECTED: "neutral",
  PROCESSED: "success",
  FAILED: "danger",
};

const REFUNDABLE_TXN_STATUSES: readonly TransactionStatus[] = ["SETTLED", "PARTIALLY_REFUNDED"];

/** Refund statuses that reserve part of the transaction amount (FAILED can still be retried). */
export const RESERVING_REFUND_STATUSES = ["PENDING_APPROVAL", "APPROVED", "PROCESSED", "FAILED"] as const satisfies readonly RefundStatus[];

type ExistingRefund = { amountCents: number; status: RefundStatus };

export function refundableCents(txnAmountCents: number, existing: readonly ExistingRefund[]): number {
  const reserved = existing
    .filter((r) => (RESERVING_REFUND_STATUSES as readonly RefundStatus[]).includes(r.status))
    .reduce((sum, r) => sum + r.amountCents, 0);
  return Math.max(0, txnAmountCents - reserved);
}

/** Business rules for a new refund request. Throws `ValidationError` with a user-facing message. */
export function validateRefundRequest(input: {
  amountCents: number | null;
  reason: string;
  txn: { status: TransactionStatus; amountCents: number };
  existing: readonly ExistingRefund[];
}): number {
  const { amountCents, reason, txn, existing } = input;
  if (amountCents === null || amountCents <= 0) throw new ValidationError("Enter a positive dollar amount, e.g. 49.99", "invalid_amount");
  if (!reason.trim()) throw new ValidationError("A reason is required", "reason_required");
  if (reason.length > 500) throw new ValidationError("Reason must be 500 characters or fewer", "reason_too_long");
  if (!REFUNDABLE_TXN_STATUSES.includes(txn.status)) throw new ValidationError(`Transactions with status ${txn.status} cannot be refunded`, "not_refundable");
  const available = refundableCents(txn.amountCents, existing);
  if (amountCents > available) {
    throw new ValidationError(`Amount exceeds the refundable balance of ${formatCents(available)}`, "amount_exceeds_refundable");
  }
  return amountCents;
}

export function isLargeRefund(amountCents: number): boolean {
  return amountCents > LARGE_REFUND_ALERT_CENTS;
}

/** Slack text for a large refund. IDs and amount only: never customer PII. */
export function largeRefundAlertText(refund: { id: string; transactionId: string; amountCents: number }): string {
  return `:rotating_light: Large refund requested: ${formatCents(refund.amountCents)} (refund ${refund.id}, transaction ${refund.transactionId}). Awaiting Finance approval.`;
}

/** Transaction status once `processedTotalCents` has been refunded to the customer. */
export function transactionStatusAfterRefunds(txnAmountCents: number, processedTotalCents: number): TransactionStatus {
  return processedTotalCents >= txnAmountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
}
