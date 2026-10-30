import { prisma, type SessionUser } from "@fintech/models";
import { FORBIDDEN, auditRowsFor, demoUsers, isRedirectTo, resetDb, runAsUser, seedDemoUsers } from "@fintech/platform/testing";
import { NextRequest } from "next/server";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { FRAUD_RING, customerRow, generateFraudRing, mulberry32 } from "../../../../../scripts/seed/generate";
import { buildTimeline, groupLinks, loadLinkedAccounts } from "./_lib/customer";
import { buildTxnWhere, parseTxnFilters, searchTransactions } from "./_lib/search";
import CustomerPage from "./customers/[id]/page";
import { GET as exportCsv } from "./export/route";
import TransactionsPage from "./page";

const { alice, rita, ada } = demoUsers;
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
const SSN = "900-12-3456";
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 12); // 2026-09-01 12:00Z
const at = (days: number) => new Date(T0 + days * DAY);

const listPage = (sp: Record<string, string> = {}) => TransactionsPage({ searchParams: Promise.resolve(sp) });
const customerPage = (id = "cus_a") => CustomerPage({ params: Promise.resolve({ id }) });
const renderCustomer = async (u: SessionUser, id = "cus_a") => renderToStaticMarkup((await runAsUser(u, () => customerPage(id))) as ReactElement);
const exportReq = (qs = "") => new NextRequest(new URL(`/transactions/export${qs}`, "http://localhost:3000"));
const page = { skip: 0, take: 25, sort: "createdAt" as const, dir: "desc" as const };

function customer(id: string, name: string, addressHash: string, extra: Partial<{ ssn: string }> = {}) {
  return { id, name, email: `${id}@example.com`, ssn: extra.ssn ?? "900-00-0000", dob: new Date("1990-01-01T00:00:00Z"), address: `1 ${name} St`, addressHash };
}

function txn(id: string, customerId: string, days: number, amountCents: number, merchant: string, deviceId: string, cardFingerprint: string) {
  return { id, customerId, createdAt: at(days), amountCents, merchant, status: "SETTLED" as const, deviceId, cardFingerprint };
}

beforeEach(async () => {
  await resetDb();
  await seedDemoUsers();
  await prisma.customer.createMany({
    data: [
      customer("cus_a", "Ann Archer", "addr_shared", { ssn: SSN }),
      customer("cus_b", "Bob Baker", "addr_b"), // shares device + card with Ann
      customer("cus_c", "Cara Cole", "addr_shared"), // shares address with Ann
      customer("cus_d", "Dan Dunn", "addr_d"), // unrelated
      customer("cus_e", "anna lower", "addr_e"), // name-prefix case-insensitivity
    ],
  });
  await prisma.transaction.createMany({
    data: [
      txn("txn_a1", "cus_a", 0, 1_000, "Amazon", "dev_shared", "card_shared"),
      txn("txn_a2", "cus_a", 5, 250_000, "Apple", "dev_a", "card_a"),
      txn("txn_a3", "cus_a", 10, 7_500, "Amazon", "dev_a", "card_a"),
      txn("txn_b1", "cus_b", 2, 4_000, "Uber", "dev_shared", "card_b"),
      txn("txn_b2", "cus_b", 3, 9_000, "Uber", "dev_b", "card_shared"),
      txn("txn_d1", "cus_d", 1, 120_000, "Apple", "dev_d", "card_d"),
      txn("txn_e1", "cus_e", 4, 3_000, "Steam", "dev_e", "card_e"),
    ],
  });
  await prisma.refund.create({
    data: { id: "ref_a", transactionId: "txn_a2", customerId: "cus_a", amountCents: 250_000, reason: "Duplicate", status: "PROCESSED", requestedById: "u_alice", createdAt: at(6), processedAt: at(7) },
  });
  await prisma.kycCase.create({
    data: {
      id: "kyc_a", customerId: "cus_a", status: "APPROVED", riskLevel: "LOW", documentType: "passport", documentNumber: "P00000001", slaDueAt: at(3),
      openedAt: at(-2), claimedAt: at(-1), recommendedAt: at(1), recommendation: "APPROVE", recommendedById: "u_alice", decidedAt: at(8), decision: "APPROVE", decidedById: "u_rita",
    },
  });
});

describe("filters (pure)", () => {
  it("parses dollars and day ranges and rejects bad input", () => {
    const f = parseTxnFilters({ minAmount: "10", maxAmount: "$1,000.50", from: "2026-09-01", to: "2026-09-02", merchant: " Amazon " });
    expect(f).toMatchObject({ minAmountCents: 1_000, maxAmountCents: 100_050, merchant: "Amazon" });
    expect(f.to?.toISOString()).toBe("2026-09-02T23:59:59.999Z");
    expect(() => parseTxnFilters({ from: "09/01/2026" })).toThrow(/YYYY-MM-DD/);
    expect(() => parseTxnFilters({ minAmount: "abc" })).toThrow(/dollar amount/);
    expect(() => parseTxnFilters({ minAmount: "10", maxAmount: "5" })).toThrow(/greater than/);
    expect(() => parseTxnFilters({ from: "2026-09-03", to: "2026-09-01" })).toThrow(/after/);
  });

  it("builds a where clause only from provided filters", () => {
    expect(buildTxnWhere({})).toEqual({});
    expect(buildTxnWhere({ merchant: "Uber", minAmountCents: 5 }, ["cus_a", "cus_b"])).toEqual({ merchant: "Uber", amountCents: { gte: 5 }, customerId: { in: ["cus_a", "cus_b"] } });
  });
});

describe("searchTransactions", () => {
  const ids = async (f: Parameters<typeof searchTransactions>[0]) => (await searchTransactions(f, page)).rows.map((r) => r.id);

  it("filters by transaction ID, customer ID, merchant, amount range and date range", async () => {
    expect(await ids({ txnId: "txn_b2" })).toEqual(["txn_b2"]);
    expect(await ids({ customer: "cus_a" })).toEqual(["txn_a3", "txn_a2", "txn_a1"]);
    expect(await ids({ merchant: "Apple" })).toEqual(["txn_a2", "txn_d1"]);
    expect(await ids({ minAmountCents: 100_000, maxAmountCents: 200_000 })).toEqual(["txn_d1"]);
    expect(await ids({ from: at(2), to: at(4) })).toEqual(["txn_e1", "txn_b2", "txn_b1"]);
    expect(await ids({ merchant: "Amazon", minAmountCents: 5_000 })).toEqual(["txn_a3"]);
  });

  it("matches customer names by case-insensitive prefix and reports totals", async () => {
    const res = await searchTransactions({ customer: "ann" }, page);
    expect(res.rows.map((r) => r.customerId).sort()).toEqual(["cus_a", "cus_a", "cus_a", "cus_e"]);
    expect(res.total).toBe(4);
    expect(await ids({ customer: "Nobody" })).toEqual([]);
  });

  it("sorts by amount and pages stably", async () => {
    const res = await searchTransactions({}, { skip: 1, take: 2, sort: "amountCents", dir: "desc" });
    expect(res.rows.map((r) => r.id)).toEqual(["txn_d1", "txn_b2"]);
    expect(res.total).toBe(7);
  });
});

describe("timeline (pure)", () => {
  it("merges transactions, refunds and KYC events newest first with deterministic ties", () => {
    const tie = at(1);
    const events = buildTimeline(
      [
        { id: "t1", createdAt: at(0), amountCents: 100, merchant: "M", status: "SETTLED" },
        { id: "t2", createdAt: tie, amountCents: 200, merchant: "M", status: "SETTLED" },
      ],
      [{ id: "r1", createdAt: tie, processedAt: at(2), amountCents: 50, status: "PROCESSED", transactionId: "t1" }],
      [{ id: "k1", openedAt: at(-1), claimedAt: null, recommendedAt: tie, recommendation: "APPROVE", decidedAt: null, decision: null, status: "RECOMMENDED" }],
    );
    expect(events.map((e) => e.key)).toEqual([
      "refund:r1:processed",
      "kyc:k1:recommended",
      "refund:r1:requested",
      "transaction:t2:created",
      "transaction:t1:created",
      "kyc:k1:opened",
    ]);
  });
});

describe("linked accounts", () => {
  it("groups links per customer, strongest first, excluding the customer itself", () => {
    const info = new Map([["x", { name: "X", riskLevel: "LOW" }], ["y", { name: "Y", riskLevel: "LOW" }]]);
    const rows = groupLinks("self", [
      { customerId: "self", kind: "device", value: "d" },
      { customerId: "y", kind: "address", value: "h" },
      { customerId: "x", kind: "device", value: "d" },
      { customerId: "x", kind: "card", value: "c" },
      { customerId: "x", kind: "card", value: "c" },
    ], info);
    expect(rows.map((r) => [r.customerId, r.links.length])).toEqual([["x", 2], ["y", 1]]);
  });

  it("finds customers sharing a device, card or address hash", async () => {
    const { identifiers, linked } = await loadLinkedAccounts("cus_a", "addr_shared");
    expect(identifiers.devices.sort()).toEqual(["dev_a", "dev_shared"]);
    expect(linked.map((l) => [l.customerId, l.links.map((x) => x.kind).sort()])).toEqual([
      ["cus_b", ["card", "device"]],
      ["cus_c", ["address"]],
    ]);
  });

  it("surfaces the seeded fraud ring as linked accounts", async () => {
    const ring = generateFraudRing(mulberry32(42));
    await prisma.customer.createMany({ data: ring.map(customerRow) });
    let n = 0;
    await prisma.transaction.createMany({
      data: ring.flatMap((c) => c.devices.flatMap((d) => c.cards.map((card) => txn(`txn_ring_${n++}`, c.id, n, 1_000, "Steam", d, card)))),
    });
    const [first = "", ...others] = FRAUD_RING.customerIds;
    const { linked } = await loadLinkedAccounts(first, ring[0]!.addressHash);
    const linkedIds = linked.map((l) => l.customerId);
    // Members 2–7 share the ring device (and some the card/address) with member 1.
    expect(linkedIds).toEqual(expect.arrayContaining(others.slice(0, 6)));
    expect(linked.find((l) => l.customerId === others[0])?.links.map((l) => l.kind)).toContain("device");
    // Every ring member links to at least one other member.
    for (const c of ring) expect((await loadLinkedAccounts(c.id, c.addressHash)).linked.length, c.id).toBeGreaterThan(0);
  });
});

describe("/transactions search page", () => {
  it("redirects anonymous users and gives Admins 403", async () => {
    const err = await runAsUser(null, () => listPage()).catch((e: unknown) => e);
    expect(isRedirectTo(err, "/login")).toBe(true);
    await expect(runAsUser(ada, () => listPage())).rejects.toMatchObject(FORBIDDEN);
  });

  it("renders results for Analysts and Reviewers without PII, and shows filter errors", async () => {
    for (const u of [alice, rita]) {
      const html = renderToStaticMarkup((await runAsUser(u, () => listPage({ customer: "cus_a" }))) as ReactElement);
      expect(html).toContain("txn_a1");
      expect(html).not.toContain("txn_b1");
      expect(html).not.toContain(SSN);
    }
    const bad = renderToStaticMarkup((await runAsUser(alice, () => listPage({ minAmount: "lots" }))) as ReactElement);
    expect(bad).toContain("must be a dollar amount");
  });
});

describe("/transactions/customers/[id]", () => {
  it("gives Admins 403 and 404s unknown customers", async () => {
    await expect(runAsUser(ada, () => customerPage())).rejects.toMatchObject(FORBIDDEN);
    await expect(runAsUser(alice, () => customerPage("cus_nope"))).rejects.toMatchObject(NOT_FOUND);
  });

  it("masks PII for Analysts and audits the view without a pii.view row", async () => {
    const html = await renderCustomer(alice);
    expect(html).toContain("•••-••-3456");
    expect(html).not.toContain(SSN);
    expect(html).not.toContain("1 Ann Archer St");
    expect((await auditRowsFor("Customer", "cus_a")).map((r) => [r.action, r.actorId])).toEqual([["customer.view", alice.id]]);
  });

  it("reveals PII to Reviewers and audits both the view and the PII reveal", async () => {
    const html = await renderCustomer(rita);
    expect(html).toContain(SSN);
    const rows = await auditRowsFor("Customer", "cus_a");
    expect(rows.map((r) => r.action)).toEqual(["customer.view", "pii.view"]);
    expect(JSON.stringify(rows)).not.toContain(SSN);
  });

  it("shows the merged timeline in order and the linked accounts", async () => {
    const html = await renderCustomer(alice);
    // Newest first: txn_a3 (day 10), KYC decided (8), refund paid (7), refund requested (6), txn_a2 (5), …, KYC opened (-2).
    expect(html.indexOf("txn_a3")).toBeLessThan(html.indexOf("KYC decision: approve"));
    expect(html.indexOf("KYC decision: approve")).toBeLessThan(html.indexOf("Refund paid out"));
    expect(html.indexOf("Refund paid out")).toBeLessThan(html.indexOf("Refund requested for txn_a2"));
    expect(html.indexOf("Refund requested for txn_a2")).toBeLessThan(html.indexOf("Transaction at Apple"));
    expect(html.indexOf("Transaction at Apple")).toBeLessThan(html.indexOf("KYC case opened"));
    expect(html).toContain("Linked accounts (2)");
    expect(html).toContain("Bob Baker");
    expect(html).toContain("Cara Cole");
    expect(html).not.toContain("Dan Dunn");
  });
});

describe("GET /transactions/export", () => {
  it("returns 401 for anonymous callers and 403 for Admins", async () => {
    expect((await runAsUser(null, () => exportCsv(exportReq()))).status).toBe(401);
    expect((await runAsUser(ada, () => exportCsv(exportReq()))).status).toBe(403);
  });

  it("exports the filtered results without PII and audits the export", async () => {
    const res = await runAsUser(alice, () => exportCsv(exportReq("?merchant=Apple")));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe("transaction_id,created_at,customer_id,customer_name,merchant,merchant_category_code,amount_cents,currency,status,device_id,card_fingerprint");
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual(["txn_a2", "txn_d1"]);
    expect(text).not.toContain(SSN);
    const [row] = await auditRowsFor("Transaction", "export");
    expect(row).toMatchObject({ action: "transaction.export", actorId: alice.id, metadata: { rowCount: 2, truncated: false, filters: { merchant: "Apple" } } });
  });

  it("rejects invalid filters with 400 and does not audit an export", async () => {
    const res = await runAsUser(alice, () => exportCsv(exportReq("?from=yesterday")));
    expect(res.status).toBe(400);
    expect(await auditRowsFor("Transaction", "export")).toHaveLength(0);
  });
});
