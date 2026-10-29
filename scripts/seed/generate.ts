import { createHash } from "node:crypto";
import type { Prisma } from "@fintech/models";

// ---------------------------------------------------------------------------
// Deterministic synthetic data. Nothing here is real: SSNs use the 9xx area
// (never issued), emails use example.com, addresses are invented.
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;
const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
const pad = (n: number, width: number) => String(n).padStart(width, "0");
const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export const DAY_MS = 86_400_000;

const FIRST = ["Olivia", "Liam", "Emma", "Noah", "Ava", "Elijah", "Sophia", "Mateo", "Isabella", "Lucas", "Mia", "Levi", "Amelia", "Ezra", "Harper", "Asher", "Evelyn", "Leo", "Abigail", "Kai", "Priya", "Wei", "Fatima", "Diego", "Yuki", "Omar", "Zara", "Ivan", "Chloe", "Arjun"];
const LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Patel", "Nguyen", "Kim", "Chen", "Singh", "Okafor", "Novak", "Rossi", "Silva"];
const STREETS = ["Oak", "Maple", "Cedar", "Pine", "Elm", "Birch", "Willow", "Lake", "Hill", "River", "Sunset", "Park", "Main", "Church", "Mill"];
const SUFFIX = ["St", "Ave", "Rd", "Blvd", "Ln", "Way", "Ct"];
const CITIES: readonly [string, string][] = [["Springfield", "IL"], ["Riverton", "WY"], ["Fairview", "TX"], ["Madison", "WI"], ["Georgetown", "KY"], ["Salem", "OR"], ["Clinton", "NY"], ["Franklin", "TN"], ["Arlington", "VA"], ["Bristol", "CT"]];
export const MERCHANTS: readonly [string, string][] = [["Amazon", "5942"], ["Walmart", "5411"], ["Target", "5310"], ["Uber", "4121"], ["Lyft", "4121"], ["Shell", "5541"], ["Starbucks", "5814"], ["Netflix", "4899"], ["Apple", "5732"], ["Delta Air Lines", "3058"], ["Marriott", "3509"], ["Home Depot", "5200"], ["CVS Pharmacy", "5912"], ["Whole Foods", "5411"], ["Steam", "5816"], ["Airbnb", "7011"], ["DoorDash", "5812"], ["Best Buy", "5732"], ["Costco", "5300"], ["Spotify", "5735"]];

export interface SeedCustomer extends Prisma.CustomerCreateManyInput {
  id: string;
  devices: string[];
  cards: string[];
}

function address(rng: Rng): string {
  const [city, state] = pick(rng, CITIES);
  return `${int(rng, 1, 9999)} ${pick(rng, STREETS)} ${pick(rng, SUFFIX)}, ${city}, ${state} ${pad(int(rng, 10000, 99999), 5)}`;
}

function ssn(rng: Rng): string {
  return `9${pad(int(rng, 0, 99), 2)}-${pad(int(rng, 1, 99), 2)}-${pad(int(rng, 1, 9999), 4)}`;
}

function dob(rng: Rng): Date {
  return new Date(Date.UTC(int(rng, 1950, 2004), int(rng, 0, 11), int(rng, 1, 28)));
}

export function generateCustomers(rng: Rng, count: number): SeedCustomer[] {
  const customers: SeedCustomer[] = [];
  for (let i = 1; i <= count; i++) {
    const first = pick(rng, FIRST);
    const last = pick(rng, LAST);
    const id = `cus_${pad(i, 6)}`;
    const addr = address(rng);
    customers.push({
      id,
      name: `${first} ${last}`,
      email: `${first}.${last}.${i}@example.com`.toLowerCase(),
      ssn: ssn(rng),
      dob: dob(rng),
      address: addr,
      addressHash: shortHash(`${addr.toLowerCase()}|${id}`),
      riskLevel: rng() < 0.85 ? "LOW" : rng() < 0.7 ? "MEDIUM" : "HIGH",
      createdAt: new Date(Date.UTC(2023, 0, 1) + int(rng, 0, 900) * DAY_MS),
      devices: Array.from({ length: int(rng, 1, 2) }, (_, d) => `dev_${shortHash(`${id}-d${d}`)}`),
      cards: Array.from({ length: int(rng, 1, 2) }, (_, c) => `card_${shortHash(`${id}-c${c}`)}`),
    });
  }
  return customers;
}

/**
 * Seeded fraud ring: 8 accounts linked through a shared device, overlapping card fingerprints,
 * and a shared address hash. Every member links to at least one other member.
 */
export const FRAUD_RING = {
  device: "dev_ring_7f3a9c",
  cards: ["card_ring_a1", "card_ring_b2", "card_ring_c3"],
  addressHash: "addr_ring_44d0e1",
  customerIds: Array.from({ length: 8 }, (_, i) => `cus_9${pad(i + 1, 5)}`),
} as const;

export function generateFraudRing(rng: Rng): SeedCustomer[] {
  const sharedAddress = "77 Quarry Rd, Fairview, TX 75069";
  return FRAUD_RING.customerIds.map((id, i) => {
    const first = pick(rng, FIRST);
    const last = pick(rng, LAST);
    const sharesAddress = i % 2 === 0;
    return {
      id,
      name: `${first} ${last}`,
      email: `${first}.${last}.ring${i}@example.com`.toLowerCase(),
      ssn: ssn(rng),
      dob: dob(rng),
      address: sharesAddress ? sharedAddress : address(rng),
      addressHash: sharesAddress ? FRAUD_RING.addressHash : shortHash(`ring-${id}`),
      riskLevel: "MEDIUM",
      createdAt: new Date(Date.now() - int(rng, 20, 60) * DAY_MS),
      devices: i < 6 ? [FRAUD_RING.device, `dev_${shortHash(`${id}-own`)}`] : [`dev_${shortHash(`${id}-own`)}`],
      cards: [FRAUD_RING.cards[i % 3] as string, `card_${shortHash(`${id}-own`)}`],
    };
  });
}

export function customerRow({ devices: _d, cards: _c, ...row }: SeedCustomer): Prisma.CustomerCreateManyInput {
  return row;
}

const STATUSES: readonly [Prisma.TransactionCreateManyInput["status"], number][] = [["SETTLED", 0.9], ["PENDING", 0.04], ["DECLINED", 0.04], ["REFUNDED", 0.015], ["PARTIALLY_REFUNDED", 0.005]];

function status(rng: Rng): Prisma.TransactionCreateManyInput["status"] {
  let r = rng();
  for (const [s, p] of STATUSES) {
    if ((r -= p) < 0) return s;
  }
  return "SETTLED";
}

/** Amounts skew small (log-uniform $1–$3,000) so both refund thresholds get exercised. */
function amountCents(rng: Rng): number {
  return Math.round(Math.exp(Math.log(100) + rng() * (Math.log(300_000) - Math.log(100))));
}

export function generateTransaction(rng: Rng, index: number, customer: SeedCustomer, now: number): Prisma.TransactionCreateManyInput {
  const [merchant, mcc] = pick(rng, MERCHANTS);
  return {
    id: `txn_${pad(index, 7)}`,
    customerId: customer.id,
    amountCents: amountCents(rng),
    currency: "USD",
    merchant,
    // ~2% of last month's transactions are missing an MCC (fodder for the Phase 10 backfill example).
    merchantCategoryCode: rng() < 0.02 ? null : mcc,
    status: status(rng),
    deviceId: pick(rng, customer.devices),
    cardFingerprint: pick(rng, customer.cards),
    createdAt: new Date(now - Math.floor(rng() * 365 * DAY_MS)),
  };
}

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------

/** The KYC case whose ID document shows a different DOB from the customer record. */
export const DOB_MISMATCH_CASE_ID = "kyc_0042";

/** Approval kind for KYC final decisions; must match `KYC_DECISION_POLICY.kind` in the KYC tool. */
export const KYC_DECISION_KIND = "kyc_decision";

export interface KycSeed {
  cases: Prisma.KycCaseCreateManyInput[];
  documents: Prisma.KycDocumentCreateManyInput[];
  /** Maker-checker requests for every recommended (pending) or decided case. */
  approvals: Prisma.ApprovalRequestCreateManyInput[];
}

export function generateKyc(rng: Rng, customers: readonly SeedCustomer[], count: number, now: number, users: { analysts: string[]; reviewer: string }): KycSeed {
  const cases: Prisma.KycCaseCreateManyInput[] = [];
  const documents: Prisma.KycDocumentCreateManyInput[] = [];
  const approvals: Prisma.ApprovalRequestCreateManyInput[] = [];
  const used = new Set<number>();
  for (let i = 1; i <= count; i++) {
    let idx = int(rng, 0, customers.length - 1);
    while (used.has(idx)) idx = (idx + 1) % customers.length;
    used.add(idx);
    const customer = customers[idx] as SeedCustomer;
    const id = `kyc_${pad(i, 4)}`;
    const mismatch = id === DOB_MISMATCH_CASE_ID;
    const riskLevel = mismatch ? "MEDIUM" : pick(rng, ["LOW", "LOW", "MEDIUM", "HIGH"] as const);
    const openedAt = new Date(now - int(rng, 1, 10 * 24) * 3_600_000);
    const slaHours = riskLevel === "HIGH" ? 24 : 72;
    const documentType = pick(rng, ["passport", "drivers_license", "national_id"] as const);
    const documentNumber = `${documentType === "passport" ? "P" : documentType === "drivers_license" ? "D" : "N"}${pad(int(rng, 0, 99_999_999), 8)}`;
    const documentExpiry = new Date(Date.UTC(int(rng, 2027, 2034), int(rng, 0, 11), int(rng, 1, 28)));
    const roll = mismatch ? 0 : rng();
    const base: Prisma.KycCaseCreateManyInput = { id, customerId: customer.id, riskLevel, documentType, documentNumber, documentExpiry, openedAt, slaDueAt: new Date(openedAt.getTime() + slaHours * 3_600_000), status: "OPEN" };
    const analyst = pick(rng, users.analysts);
    if (roll >= 0.4 && roll < 0.65) Object.assign(base, { status: "IN_REVIEW", assigneeId: analyst, claimedAt: new Date(openedAt.getTime() + 3_600_000) });
    else if (roll >= 0.65 && roll < 0.8) {
      Object.assign(base, { status: "RECOMMENDED", assigneeId: analyst, claimedAt: openedAt, recommendation: rng() < 0.8 ? "APPROVE" : "REJECT", recommendationNotes: "Documents consistent with application.", recommendedById: analyst, recommendedAt: new Date(openedAt.getTime() + 2 * 3_600_000) });
    } else if (roll >= 0.8) {
      const outcome = rng() < 0.85 ? "APPROVE" : "REJECT";
      Object.assign(base, { status: outcome === "APPROVE" ? "APPROVED" : "REJECTED", assigneeId: analyst, claimedAt: openedAt, recommendation: outcome, recommendationNotes: "Checked against watchlists.", recommendedById: analyst, recommendedAt: openedAt, decision: outcome, decisionReason: outcome === "APPROVE" ? "Identity verified." : "Document could not be verified.", decidedById: users.reviewer, decidedAt: new Date(openedAt.getTime() + 5 * 3_600_000) });
    }
    cases.push(base);
    if (base.recommendedById) {
      approvals.push({
        id: `apr_${id}`,
        kind: KYC_DECISION_KIND,
        entityType: "KycCase",
        entityId: id,
        approverRoles: ["Reviewer"],
        requesterId: base.recommendedById,
        status: base.decision ? (base.decision === "APPROVE" ? "APPROVED" : "REJECTED") : "PENDING",
        decidedById: base.decidedById ?? null,
        decidedAt: base.decidedAt ?? null,
        decisionReason: base.decisionReason ?? null,
        createdAt: base.recommendedAt ?? openedAt,
      });
    }

    const customerDob = customer.dob as Date;
    const printedDob = mismatch ? new Date(Date.UTC(customerDob.getUTCFullYear() - 2, customerDob.getUTCMonth(), customerDob.getUTCDate())) : customerDob;
    documents.push({
      id: `${id}_doc1`,
      caseId: id,
      kind: documentType,
      fileName: `${documentType}_${customer.id}.png`,
      uploadedAt: openedAt,
      fixture: { name: customer.name, dob: printedDob.toISOString().slice(0, 10), documentNumber, expiry: documentExpiry.toISOString().slice(0, 10) },
    });
    documents.push({ id: `${id}_doc2`, caseId: id, kind: "proof_of_address", fileName: `utility_bill_${customer.id}.pdf`, uploadedAt: openedAt });
  }
  return { cases, documents, approvals };
}

// ---------------------------------------------------------------------------
// Refunds (+ their approval requests)
// ---------------------------------------------------------------------------

export const REFUND_AUTO_APPROVE_MAX_CENTS = 50_000;

export interface RefundSeed {
  refunds: Prisma.RefundCreateManyInput[];
  approvals: Prisma.ApprovalRequestCreateManyInput[];
}

export function generateRefunds(rng: Rng, txns: readonly Prisma.TransactionCreateManyInput[], now: number, users: { requesters: string[]; approvers: string[] }): RefundSeed {
  const refunds: Prisma.RefundCreateManyInput[] = [];
  const approvals: Prisma.ApprovalRequestCreateManyInput[] = [];
  txns.forEach((t, i) => {
    const id = `ref_seed_${pad(i + 1, 4)}`;
    const approvalId = `apr_seed_${pad(i + 1, 4)}`;
    const amount = rng() < 0.7 ? t.amountCents : Math.max(100, Math.floor(t.amountCents * (0.2 + rng() * 0.6)));
    const createdAt = new Date(now - int(rng, 0, 60 * 24) * 3_600_000);
    const requester = pick(rng, users.requesters);
    const approver = pick(rng, users.approvers);
    const needsApproval = amount > REFUND_AUTO_APPROVE_MAX_CENTS;
    const roll = rng();
    let status: Prisma.RefundCreateManyInput["status"];
    let approvalStatus: Prisma.ApprovalRequestCreateManyInput["status"];
    if (!needsApproval) {
      approvalStatus = "AUTO_APPROVED";
      status = roll < 0.95 ? "PROCESSED" : "FAILED";
    } else if (roll < 0.25) {
      approvalStatus = "PENDING";
      status = "PENDING_APPROVAL";
    } else if (roll < 0.35) {
      approvalStatus = "REJECTED";
      status = "REJECTED";
    } else {
      approvalStatus = "APPROVED";
      status = "PROCESSED";
    }
    const decided = approvalStatus !== "PENDING";
    approvals.push({
      id: approvalId,
      kind: "refund",
      entityType: "Refund",
      entityId: id,
      amountCents: amount,
      approverRoles: ["Reviewer"],
      status: approvalStatus,
      requesterId: requester,
      decidedById: decided && approvalStatus !== "AUTO_APPROVED" ? approver : null,
      decidedAt: decided ? new Date(createdAt.getTime() + 3_600_000) : null,
      decisionReason: approvalStatus === "REJECTED" ? "Outside refund policy." : approvalStatus === "AUTO_APPROVED" ? "Auto-approved: amount at or below 50000 cents" : null,
      createdAt,
    });
    refunds.push({
      id,
      transactionId: t.id as string,
      customerId: t.customerId,
      amountCents: amount,
      reason: pick(rng, ["Item not received", "Duplicate charge", "Service not as described", "Cancelled subscription", "Goodwill credit"]),
      status,
      requestedById: requester,
      approvalRequestId: approvalId,
      externalRefundId: status === "PROCESSED" ? `re_seed_${pad(i + 1, 4)}` : null,
      processedAt: status === "PROCESSED" ? new Date(createdAt.getTime() + 2 * 3_600_000) : null,
      createdAt,
    });
  });
  return { refunds, approvals };
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

const FLAG_KEYS: readonly [string, string][] = [
  ["instant-payouts", "Instant payouts to debit cards"],
  ["new-onboarding-flow", "Redesigned customer onboarding"],
  ["card-freeze-self-serve", "Customers can freeze cards in-app"],
  ["kyc-auto-doc-check", "Automated document checks in KYC"],
  ["refund-auto-approve", "Auto-approve small refunds"],
  ["dispute-chatbot", "Chatbot-assisted disputes"],
  ["crypto-buy", "Buy crypto from balance"],
  ["savings-roundups", "Round-up transfers to savings"],
  ["risk-model-v3", "Risk scoring model v3"],
  ["dark-mode", "Dark mode in the mobile app"],
  ["p2p-requests", "Request money from contacts"],
  ["statement-pdf-v2", "New PDF statement renderer"],
];

export function generateFlags(rng: Rng): Prisma.FeatureFlagCreateManyInput[] {
  return FLAG_KEYS.flatMap(([key, description]) =>
    (["dev", "staging", "prod"] as const).map((environment) => {
      const enabled = environment === "dev" ? rng() < 0.9 : environment === "staging" ? rng() < 0.6 : rng() < 0.35;
      return { key, description, environment, enabled, rolloutPercentage: enabled ? (environment === "prod" ? pick(rng, [5, 10, 25, 50, 100]) : 100) : 0 };
    }),
  );
}
