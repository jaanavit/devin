import { describe, expect, it } from "vitest";
import {
  DOB_MISMATCH_CASE_ID,
  FRAUD_RING,
  KYC_DECISION_KIND,
  REFUND_AUTO_APPROVE_MAX_CENTS,
  generateCustomers,
  generateFlags,
  generateFraudRing,
  generateKyc,
  generateRefunds,
  generateTransaction,
  mulberry32,
} from "./generate";

const now = Date.UTC(2026, 9, 29);

describe("seed generators", () => {
  it("are deterministic", () => {
    expect(generateCustomers(mulberry32(1), 5)).toEqual(generateCustomers(mulberry32(1), 5));
  });

  it("only produce never-issued SSNs (9xx area) and example.com emails", () => {
    for (const c of generateCustomers(mulberry32(2), 200)) {
      expect(c.ssn).toMatch(/^9\d{2}-\d{2}-\d{4}$/);
      expect(c.email).toMatch(/@example\.com$/);
    }
  });

  it("links every fraud-ring member to another member via device, card or address", () => {
    const ring = generateFraudRing(mulberry32(3));
    expect(ring.map((c) => c.id)).toEqual(FRAUD_RING.customerIds);
    for (const member of ring) {
      const others = ring.filter((o) => o.id !== member.id);
      const linked = others.some(
        (o) => o.devices.some((d) => member.devices.includes(d)) || o.cards.some((c) => member.cards.includes(c)) || o.addressHash === member.addressHash,
      );
      expect(linked, member.id).toBe(true);
    }
  });

  it("seeds exactly one KYC case whose document DOB differs from the customer DOB", () => {
    const customers = generateCustomers(mulberry32(4), 500);
    const { cases, documents } = generateKyc(mulberry32(5), customers, 200, now, { analysts: ["u_alice"], reviewer: "u_rita" });
    expect(cases).toHaveLength(200);
    const mismatched = documents.filter((d) => {
      const fixture = d.fixture as { dob?: string } | undefined;
      if (!fixture?.dob) return false;
      const kase = cases.find((c) => c.id === d.caseId);
      const customer = customers.find((c) => c.id === kase?.customerId);
      return (customer?.dob as Date).toISOString().slice(0, 10) !== fixture.dob;
    });
    expect(mismatched.map((d) => d.caseId)).toEqual([DOB_MISMATCH_CASE_ID]);
  });

  it("creates a maker-checker request for every recommended or decided KYC case", () => {
    const customers = generateCustomers(mulberry32(4), 500);
    const { cases, approvals } = generateKyc(mulberry32(5), customers, 200, now, { analysts: ["u_alice", "u_sam"], reviewer: "u_rita" });
    const prepared = cases.filter((c) => c.recommendedById);
    expect(approvals.map((a) => a.entityId)).toEqual(prepared.map((c) => c.id));
    for (const a of approvals) {
      const kase = prepared.find((c) => c.id === a.entityId)!;
      expect(a).toMatchObject({ kind: KYC_DECISION_KIND, entityType: "KycCase", requesterId: kase.recommendedById });
      expect(a.status).toBe(kase.status === "RECOMMENDED" ? "PENDING" : kase.status);
      expect(a.decidedById).not.toBe(a.requesterId);
    }
    expect(approvals.some((a) => a.status === "PENDING")).toBe(true);
  });

  it("creates refunds whose approval state respects the $500 threshold", () => {
    const customers = generateCustomers(mulberry32(6), 50);
    const rng = mulberry32(7);
    const txns = Array.from({ length: 300 }, (_, i) => generateTransaction(rng, i, customers[i % 50]!, now));
    const { refunds, approvals } = generateRefunds(mulberry32(8), txns, now, { requesters: ["u_aaron"], approvers: ["u_felix"] });
    expect(refunds).toHaveLength(300);
    for (const a of approvals) {
      if ((a.amountCents ?? 0) <= REFUND_AUTO_APPROVE_MAX_CENTS) expect(a.status).toBe("AUTO_APPROVED");
      else expect(a.status).not.toBe("AUTO_APPROVED");
      expect(a.decidedById).not.toBe(a.requesterId);
    }
    expect(approvals.some((a) => a.status === "PENDING")).toBe(true);
  });

  it("creates a dozen flags in each of dev/staging/prod", () => {
    const flags = generateFlags(mulberry32(9));
    expect(new Set(flags.map((f) => f.key)).size).toBe(12);
    expect(flags).toHaveLength(36);
  });
});
