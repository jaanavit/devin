import type { AddressInfo } from "node:net";
import { prisma, type SessionUser } from "@fintech/models";
import { FORBIDDEN, auditRowsFor, demoUsers, isRedirectTo, resetDb, runAsUser, seedDemoUsers } from "@fintech/platform/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPaymentsServer, type RefundLog } from "../../../../../services/payments-mock/src/server";
import { createMemoryRefundLog, prismaTransactionSource } from "../../../../../services/payments-mock/src/sources";
import RefundDetailPage from "./[id]/page";
import { approveRefund, createRefund, rejectRefund, retryRefund } from "./actions";
import NewRefundPage from "./new/page";
import RefundsPage from "./page";

// Real payments-mock server (in-process, backed by the test DB) so tests can inspect its refund log.
let refundLog = createMemoryRefundLog();
const proxyLog: RefundLog = { append: (e) => refundLog.append(e), find: (id) => refundLog.find(id), list: () => refundLog.list() };
const server = createPaymentsServer({ transactions: prismaTransactionSource, refundLog: proxyLog, token: "test-token", log: () => {} });
let paymentsUrl = "";

const SLACK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
const realFetch = globalThis.fetch;
const slackCalls = vi.fn();
const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://hooks.slack.com/")) {
    slackCalls(url, JSON.parse(String(init?.body)));
    return new Response("ok");
  }
  return realFetch(input, init);
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

async function requestRefund(user: SessionUser, transactionId: string, amount: string, reason = "Duplicate charge") {
  const out = await runAsUser(user, () => createRefund(null, form({ transactionId, amount, reason }))).catch((e: unknown) => e);
  const refund = await prisma.refund.findFirst({ where: { transactionId }, orderBy: { createdAt: "desc" } });
  return { out, refund };
}

const refundOf = (id: string) => prisma.refund.findUniqueOrThrow({ where: { id } });
const approvalOf = async (refundId: string) => prisma.approvalRequest.findUniqueOrThrow({ where: { id: (await refundOf(refundId)).approvalRequestId ?? "" } });
const auditActions = async (entityType: string, id: string) => (await auditRowsFor(entityType, id)).map((r) => r.action);

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  paymentsUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  await resetDb();
  await seedDemoUsers();
  refundLog = createMemoryRefundLog();
  slackCalls.mockReset();
  vi.stubEnv("PAYMENTS_MOCK_URL", paymentsUrl);
  vi.stubEnv("SLACK_WEBHOOK_URL", "");
  vi.stubGlobal("fetch", fetchSpy);
  await prisma.customer.create({
    data: { id: "cus_1", name: "Pat Customer", email: "pat@example.test", ssn: "123-45-6789", dob: new Date("1990-01-01"), address: "1 Main St", addressHash: "h1" },
  });
  const base = { customerId: "cus_1", merchant: "Shop", deviceId: "d1", cardFingerprint: "f1", createdAt: new Date("2026-10-01") };
  await prisma.transaction.createMany({
    data: [
      { ...base, id: "txn_a", amountCents: 100_000, status: "SETTLED" },
      { ...base, id: "txn_big", amountCents: 300_000, status: "SETTLED" },
      { ...base, id: "txn_declined", amountCents: 10_000, status: "DECLINED" },
    ],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchSpy.mockClear();
  vi.restoreAllMocks();
});

describe("refund pages (RBAC)", () => {
  const noParams = { searchParams: Promise.resolve({}) };

  it("list: anonymous is redirected, Admin gets 403, Analyst and Reviewer render", async () => {
    expect(isRedirectTo(await runAsUser(null, () => RefundsPage(noParams)).catch((e: unknown) => e), "/login")).toBe(true);
    await expect(runAsUser(demoUsers.ada, () => RefundsPage(noParams))).rejects.toMatchObject(FORBIDDEN);
    await expect(runAsUser(demoUsers.alice, () => RefundsPage(noParams))).resolves.toBeTruthy();
    await expect(runAsUser(demoUsers.rita, () => RefundsPage(noParams))).resolves.toBeTruthy();
  });

  it("list: search by customer or transaction ID goes through payments-mock", async () => {
    for (const q of ["cus_1", "txn_a"]) {
      await runAsUser(demoUsers.rita, () => RefundsPage({ searchParams: Promise.resolve({ q }) }));
      expect(fetchSpy).toHaveBeenCalledWith(`${paymentsUrl}/transactions?q=${q}&pageSize=100`, expect.anything());
    }
  });

  it("list: still renders when payments-mock is down", async () => {
    vi.stubEnv("PAYMENTS_MOCK_URL", "http://127.0.0.1:1");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(runAsUser(demoUsers.alice, () => RefundsPage({ searchParams: Promise.resolve({ q: "cus_1" }) }))).resolves.toBeTruthy();
  });

  it("new: only Analysts may open it; it searches payments-mock", async () => {
    const sp = { searchParams: Promise.resolve({ q: "cus_1", transactionId: "txn_a" }) };
    await expect(runAsUser(demoUsers.rita, () => NewRefundPage(sp))).rejects.toMatchObject(FORBIDDEN);
    await expect(runAsUser(demoUsers.ada, () => NewRefundPage(sp))).rejects.toMatchObject(FORBIDDEN);
    await expect(runAsUser(demoUsers.alice, () => NewRefundPage(sp))).resolves.toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining(`${paymentsUrl}/transactions?q=cus_1`), expect.anything());
  });

  it("detail: Admin gets 403, Analyst and Reviewer render, unknown id is 404", async () => {
    const { refund } = await requestRefund(demoUsers.alice, "txn_a", "10.00");
    const params = { params: Promise.resolve({ id: refund!.id }) };
    await expect(runAsUser(demoUsers.ada, () => RefundDetailPage(params))).rejects.toMatchObject(FORBIDDEN);
    await expect(runAsUser(demoUsers.alice, () => RefundDetailPage(params))).resolves.toBeTruthy();
    await expect(runAsUser(demoUsers.rita, () => RefundDetailPage(params))).resolves.toBeTruthy();
    await expect(runAsUser(demoUsers.rita, () => RefundDetailPage({ params: Promise.resolve({ id: "nope" }) }))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });
});

describe("createRefund", () => {
  it("is denied to anonymous users, Reviewer-only and Admin users", async () => {
    const fd = () => form({ transactionId: "txn_a", amount: "10", reason: "x" });
    expect(await runAsUser(null, () => createRefund(null, fd()))).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await runAsUser(demoUsers.rita, () => createRefund(null, fd()))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await runAsUser(demoUsers.ada, () => createRefund(null, fd()))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await prisma.refund.count()).toBe(0);
  });

  it("$499 auto-approves, calls POST /refunds, and appears in the payments-mock log", async () => {
    const { out, refund } = await requestRefund(demoUsers.alice, "txn_a", "499.00");
    expect(isRedirectTo(out, `/refunds/${refund!.id}`)).toBe(true);
    const saved = await refundOf(refund!.id);
    expect(saved).toMatchObject({ status: "PROCESSED", amountCents: 49_900, requestedById: "u_alice" });
    expect((await approvalOf(saved.id)).status).toBe("AUTO_APPROVED");
    const log = await refundLog.list();
    expect(log).toEqual([expect.objectContaining({ refundId: saved.id, transactionId: "txn_a", amountCents: 49_900, externalRefundId: saved.externalRefundId })]);
    expect(await auditActions("Refund", saved.id)).toEqual(["refund.create", "refund.process"]);
    expect(await auditActions("ApprovalRequest", saved.approvalRequestId!)).toEqual(["approval.auto_approve"]);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: "txn_a" } })).status).toBe("PARTIALLY_REFUNDED");
    expect(await auditActions("Transaction", "txn_a")).toEqual(["transaction.refund_status"]);
  });

  it("exactly $500 still auto-approves", async () => {
    const { refund } = await requestRefund(demoUsers.alice, "txn_a", "500");
    expect((await refundOf(refund!.id)).status).toBe("PROCESSED");
  });

  it("$501 waits for a second person and is not sent to payments", async () => {
    const { out, refund } = await requestRefund(demoUsers.alice, "txn_a", "501.00");
    expect(isRedirectTo(out, `/refunds/${refund!.id}`)).toBe(true);
    expect(await refundOf(refund!.id)).toMatchObject({ status: "PENDING_APPROVAL", externalRefundId: null });
    expect(await approvalOf(refund!.id)).toMatchObject({ status: "PENDING", approverRoles: ["Reviewer"], requesterId: "u_alice" });
    expect(await refundLog.list()).toEqual([]);
    expect(await auditActions("Refund", refund!.id)).toEqual(["refund.create"]);
  });

  it("rejects invalid input and over-refunds", async () => {
    const attempt = (txn: string, amount: string, reason = "r") => runAsUser(demoUsers.alice, () => createRefund(null, form({ transactionId: txn, amount, reason })));
    expect(await attempt("txn_a", "abc")).toMatchObject({ ok: false, code: "invalid_amount" });
    expect(await attempt("txn_a", "0")).toMatchObject({ ok: false, code: "invalid_amount" });
    expect(await attempt("txn_a", "10", " ")).toMatchObject({ ok: false, code: "reason_required" });
    expect(await attempt("txn_declined", "10")).toMatchObject({ ok: false, code: "not_refundable" });
    expect(await attempt("txn_missing", "10")).toMatchObject({ ok: false, code: "not_found" });
    expect(await attempt("txn_a", "1000.01")).toMatchObject({ ok: false, code: "amount_exceeds_refundable" });
    await requestRefund(demoUsers.alice, "txn_a", "600"); // pending, reserves $600
    expect(await attempt("txn_a", "400.01")).toMatchObject({ ok: false, code: "amount_exceeds_refundable" });
    expect(await prisma.refund.count()).toBe(1);
  });
});

describe("approveRefund / rejectRefund (maker-checker)", () => {
  it("only Reviewers can decide; the requester can never approve their own refund", async () => {
    const { refund } = await requestRefund(demoUsers.sam, "txn_a", "501");
    const id = refund!.id;
    expect(await runAsUser(demoUsers.alice, () => approveRefund(null, form({ id })))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await runAsUser(demoUsers.ada, () => rejectRefund(null, form({ id, reason: "no" })))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await runAsUser(demoUsers.sam, () => approveRefund(null, form({ id })))).toMatchObject({ ok: false, code: "self_approval" });
    expect(await runAsUser(demoUsers.sam, () => rejectRefund(null, form({ id, reason: "no" })))).toMatchObject({ ok: false, code: "self_approval" });
    expect((await refundOf(id)).status).toBe("PENDING_APPROVAL");
    expect(await refundLog.list()).toEqual([]);
  });

  it("a different Reviewer approves; the refund is sent to payments-mock and audited", async () => {
    const { refund } = await requestRefund(demoUsers.alice, "txn_a", "501");
    const id = refund!.id;
    const res = await runAsUser(demoUsers.rita, () => approveRefund(null, form({ id, note: "ok" })));
    expect(res).toMatchObject({ ok: true, message: "Refund approved and sent to payments." });
    const saved = await refundOf(id);
    expect(saved.status).toBe("PROCESSED");
    expect(await approvalOf(id)).toMatchObject({ status: "APPROVED", decidedById: "u_rita", decisionReason: "ok" });
    expect(await refundLog.list()).toEqual([expect.objectContaining({ refundId: id, amountCents: 50_100, externalRefundId: saved.externalRefundId })]);
    expect(await auditActions("Refund", id)).toEqual(["refund.create", "refund.approve", "refund.process"]);
    expect(await auditActions("ApprovalRequest", saved.approvalRequestId!)).toEqual(["approval.request", "approval.approve"]);

    expect(await runAsUser(demoUsers.felix, () => approveRefund(null, form({ id })))).toMatchObject({ ok: false, code: "not_pending" });
  });

  it("rejection needs a reason, is audited, and never reaches payments-mock", async () => {
    const { refund } = await requestRefund(demoUsers.alice, "txn_a", "750");
    const id = refund!.id;
    expect(await runAsUser(demoUsers.rita, () => rejectRefund(null, form({ id, reason: "  " })))).toMatchObject({ ok: false, code: "reason_required" });
    expect(await runAsUser(demoUsers.rita, () => rejectRefund(null, form({ id, reason: "Outside policy" })))).toMatchObject({ ok: true });
    expect(await refundOf(id)).toMatchObject({ status: "REJECTED" });
    expect(await approvalOf(id)).toMatchObject({ status: "REJECTED", decisionReason: "Outside policy" });
    expect(await auditActions("Refund", id)).toEqual(["refund.create", "refund.reject"]);
    expect(await refundLog.list()).toEqual([]);
    // A rejected refund no longer reserves the balance.
    const { refund: again } = await requestRefund(demoUsers.alice, "txn_a", "1000");
    expect(again!.id).not.toBe(id);
  });
});

describe("payments failures and retry", () => {
  it("marks the refund FAILED when payments-mock is unreachable; retry sends it once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("PAYMENTS_MOCK_URL", "http://127.0.0.1:1");
    const { refund } = await requestRefund(demoUsers.alice, "txn_a", "25");
    const id = refund!.id;
    expect((await refundOf(id)).status).toBe("FAILED");
    expect(await auditActions("Refund", id)).toEqual(["refund.create", "refund.process_fail"]);

    vi.stubEnv("PAYMENTS_MOCK_URL", paymentsUrl);
    expect(await runAsUser(demoUsers.ada, () => retryRefund(null, form({ id })))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await runAsUser(demoUsers.aaron, () => retryRefund(null, form({ id })))).toMatchObject({ ok: true, message: "Retry finished and sent to payments." });
    expect((await refundOf(id)).status).toBe("PROCESSED");
    expect(await refundLog.list()).toHaveLength(1);
    expect(await auditActions("Refund", id)).toEqual(["refund.create", "refund.process_fail", "refund.process"]);
    expect(await runAsUser(demoUsers.aaron, () => retryRefund(null, form({ id })))).toMatchObject({ ok: false, code: "not_failed" });
  });
});

describe("Slack alert for refunds over $2,000", () => {
  it("posts to SLACK_WEBHOOK_URL via outboundFetch, without customer PII", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", SLACK_URL);
    const { refund } = await requestRefund(demoUsers.alice, "txn_big", "2000.01");
    expect(slackCalls).toHaveBeenCalledTimes(1);
    const [url, body] = slackCalls.mock.calls[0]!;
    expect(url).toBe(SLACK_URL);
    expect(body.text).toContain("$2,000.01");
    expect(body.text).toContain(refund!.id);
    expect(body.text).not.toMatch(/Pat Customer|pat@example|123-45-6789|Main St/);
  });

  it("does not alert at exactly $2,000", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", SLACK_URL);
    await requestRefund(demoUsers.alice, "txn_big", "2000.00");
    expect(slackCalls).not.toHaveBeenCalled();
  });

  it("logs a console stub (IDs only) when SLACK_WEBHOOK_URL is empty", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { refund } = await requestRefund(demoUsers.alice, "txn_big", "2500");
    expect(slackCalls).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/^slack stub: .*refund /));
    expect(info.mock.calls.flat().join(" ")).toContain(refund!.id);
    expect(info.mock.calls.flat().join(" ")).not.toMatch(/Pat Customer|cus_1/);
  });

  it("a Slack failure does not block the refund", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("SLACK_WEBHOOK_URL", SLACK_URL);
    slackCalls.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { refund } = await requestRefund(demoUsers.alice, "txn_big", "2500");
    expect((await refundOf(refund!.id)).status).toBe("PENDING_APPROVAL");
  });
});
