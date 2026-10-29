import type { AddressInfo } from "node:net";
import type { PaymentsTransaction } from "@fintech/models/payments";
import { createPaymentsClient } from "@fintech/platform/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPaymentsServer, type TransactionSource } from "./server";
import { createMemoryRefundLog } from "./sources";

const txns: PaymentsTransaction[] = Array.from({ length: 30 }, (_, i) => ({
  id: `txn_${i}`,
  customerId: i < 20 ? "cus_a" : "cus_b",
  customerName: i < 20 ? "Ann" : "Bob",
  amountCents: 10_000,
  currency: "USD",
  merchant: "Shop",
  status: "SETTLED",
  createdAt: new Date(2026, 0, i + 1).toISOString(),
}));

const source: TransactionSource = {
  async search({ q, customerId, page = 1, pageSize = 25 }) {
    const hits = txns.filter((t) => (!customerId || t.customerId === customerId) && (!q || t.id === q || t.customerId === q || t.customerName.toLowerCase().startsWith(q.toLowerCase())));
    return { items: hits.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: hits.length };
  },
  async get(id) {
    return txns.find((t) => t.id === id) ?? null;
  },
};

const refundLog = createMemoryRefundLog();
const log = vi.fn();
const server = createPaymentsServer({ transactions: source, refundLog, token: "secret", log });
let base = "";
const auth = { authorization: "Bearer secret" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON access in assertions
const json = async (res: Response): Promise<any> => res.json();

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("payments-mock", () => {
  it("serves /health without auth but requires the bearer token elsewhere", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/transactions`)).status).toBe(401);
    expect((await fetch(`${base}/transactions`, { headers: { authorization: "Bearer wrong!" } })).status).toBe(401);
  });

  it("searches and paginates transactions", async () => {
    const res = await fetch(`${base}/transactions?q=ann&page=2&pageSize=15`, { headers: auth });
    const body = await json(res);
    expect(body).toMatchObject({ page: 2, pageSize: 15, total: 20 });
    expect(body.items).toHaveLength(5);
  });

  it("clamps page size", async () => {
    const body = await json(await fetch(`${base}/transactions?pageSize=5000`, { headers: auth }));
    expect(body.pageSize).toBe(100);
  });

  it("accepts a refund, logs the call, and is idempotent on refundId", async () => {
    const payload = { refundId: "ref_1", transactionId: "txn_3", amountCents: 2_500 };
    const first = await fetch(`${base}/refunds`, { method: "POST", headers: auth, body: JSON.stringify(payload) });
    expect(first.status).toBe(201);
    const { externalRefundId } = await json(first);
    const replay = await fetch(`${base}/refunds`, { method: "POST", headers: auth, body: JSON.stringify(payload) });
    expect((await json(replay)).externalRefundId).toBe(externalRefundId);
    expect(await refundLog.list()).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("refundId=ref_1"));
    const logRes = await json(await fetch(`${base}/refunds/log`, { headers: auth }));
    expect(logRes.items[0]).toMatchObject(payload);
  });

  it("validates refunds", async () => {
    const post = (body: unknown) => fetch(`${base}/refunds`, { method: "POST", headers: auth, body: JSON.stringify(body) });
    expect((await post({ refundId: "r", transactionId: "txn_1", amountCents: -1 })).status).toBe(400);
    expect((await post({ refundId: "r", transactionId: "nope", amountCents: 1 })).status).toBe(404);
    expect((await post({ refundId: "r", transactionId: "txn_1", amountCents: 10_001 })).status).toBe(422);
    expect((await fetch(`${base}/refunds`, { method: "POST", headers: auth, body: "{not json" })).status).toBe(400);
  });

  it("works through the platform PaymentsClient", async () => {
    const client = createPaymentsClient(base, "secret");
    vi.stubEnv("PAYMENTS_MOCK_URL", base);
    const page = await client.searchTransactions({ customerId: "cus_b" });
    expect(page.total).toBe(10);
    const refund = await client.createRefund({ refundId: "ref_2", transactionId: "txn_25", amountCents: 100 });
    expect(refund.status).toBe("accepted");
    vi.unstubAllEnvs();
  });
});
