import { needsSecondApprover } from "@fintech/platform/server";
import { describe, expect, it } from "vitest";
import { REFUND_POLICY, isLargeRefund, largeRefundAlertText, refundableCents, transactionStatusAfterRefunds, validateRefundRequest } from "./policy";

describe("refund policy", () => {
  it("auto-approves up to $500 and needs a Reviewer above it", () => {
    expect(needsSecondApprover(REFUND_POLICY, 49_900)).toBe(false);
    expect(needsSecondApprover(REFUND_POLICY, 50_000)).toBe(false);
    expect(needsSecondApprover(REFUND_POLICY, 50_100)).toBe(true);
    expect(REFUND_POLICY.approverRoles).toEqual(["Reviewer"]);
  });

  it("alerts strictly above $2,000", () => {
    expect(isLargeRefund(200_000)).toBe(false);
    expect(isLargeRefund(200_001)).toBe(true);
  });

  it("computes the refundable balance, ignoring rejected refunds", () => {
    expect(
      refundableCents(10_000, [
        { amountCents: 2_000, status: "PROCESSED" },
        { amountCents: 1_000, status: "PENDING_APPROVAL" },
        { amountCents: 500, status: "FAILED" },
        { amountCents: 9_000, status: "REJECTED" },
      ]),
    ).toBe(6_500);
    expect(refundableCents(1_000, [{ amountCents: 2_000, status: "PROCESSED" }])).toBe(0);
  });

  it("validates refund requests", () => {
    const txn = { status: "SETTLED" as const, amountCents: 10_000 };
    expect(validateRefundRequest({ amountCents: 10_000, reason: "r", txn, existing: [] })).toBe(10_000);
    expect(() => validateRefundRequest({ amountCents: null, reason: "r", txn, existing: [] })).toThrow(/positive/);
    expect(() => validateRefundRequest({ amountCents: 100, reason: "", txn, existing: [] })).toThrow(/reason/i);
    expect(() => validateRefundRequest({ amountCents: 100, reason: "x".repeat(501), txn, existing: [] })).toThrow(/500 characters/);
    expect(() => validateRefundRequest({ amountCents: 100, reason: "r", txn: { ...txn, status: "PENDING" }, existing: [] })).toThrow(/cannot be refunded/);
    expect(() => validateRefundRequest({ amountCents: 10_001, reason: "r", txn, existing: [] })).toThrow(/\$100\.00/);
  });

  it("derives the transaction status from processed refunds", () => {
    expect(transactionStatusAfterRefunds(10_000, 4_000)).toBe("PARTIALLY_REFUNDED");
    expect(transactionStatusAfterRefunds(10_000, 10_000)).toBe("REFUNDED");
  });

  it("alert text carries IDs and amount only", () => {
    expect(largeRefundAlertText({ id: "ref_1", transactionId: "txn_1", amountCents: 250_000 })).toBe(
      ":rotating_light: Large refund requested: $2,500.00 (refund ref_1, transaction txn_1). Awaiting Finance approval.",
    );
  });
});
