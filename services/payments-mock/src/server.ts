import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
  PaymentsRefundLogEntry,
  PaymentsRefundRequest,
  PaymentsTransaction,
  PaymentsTransactionPage,
  PaymentsTransactionQuery,
} from "@fintech/models/payments";

export interface TransactionSource {
  search(query: PaymentsTransactionQuery): Promise<PaymentsTransactionPage>;
  get(id: string): Promise<PaymentsTransaction | null>;
}

export interface RefundLog {
  append(entry: PaymentsRefundLogEntry): Promise<void>;
  find(refundId: string): Promise<PaymentsRefundLogEntry | undefined>;
  list(): Promise<PaymentsRefundLogEntry[]>;
}

export interface PaymentsServerDeps {
  transactions: TransactionSource;
  refundLog: RefundLog;
  /** Shared bearer token required on every endpoint except /health. */
  token: string;
  log?: (line: string) => void;
}

const MAX_PAGE_SIZE = 100;
const MAX_BODY_BYTES = 16 * 1024;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const presented = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return token.length > 0 && presented.length === expected.length && timingSafeEqual(presented, expected);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function parseRefund(body: unknown): PaymentsRefundRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { refundId, transactionId, amountCents } = body as Record<string, unknown>;
  if (typeof refundId !== "string" || !refundId || typeof transactionId !== "string" || !transactionId) return null;
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) return null;
  return { refundId, transactionId, amountCents };
}

function intParam(value: string | null, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

export function createPaymentsServer({ transactions, refundLog, token, log = console.info }: PaymentsServerDeps): Server {
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true });
    if (!authorized(req, token)) return sendJson(res, 401, { error: "unauthorized" });

    if (req.method === "GET" && url.pathname === "/transactions") {
      const page = await transactions.search({
        q: url.searchParams.get("q")?.trim() || undefined,
        customerId: url.searchParams.get("customerId")?.trim() || undefined,
        page: intParam(url.searchParams.get("page"), 1, 10_000),
        pageSize: intParam(url.searchParams.get("pageSize"), 25, MAX_PAGE_SIZE),
      });
      return sendJson(res, 200, page);
    }

    if (req.method === "POST" && url.pathname === "/refunds") {
      const refund = parseRefund(await readJson(req));
      if (!refund) return sendJson(res, 400, { error: "invalid_refund" });
      const existing = await refundLog.find(refund.refundId);
      if (existing) {
        log(`POST /refunds replay refundId=${refund.refundId} externalRefundId=${existing.externalRefundId}`);
        return sendJson(res, 200, { externalRefundId: existing.externalRefundId, status: existing.status, receivedAt: existing.receivedAt });
      }
      const txn = await transactions.get(refund.transactionId);
      if (!txn) return sendJson(res, 404, { error: "transaction_not_found" });
      if (refund.amountCents > txn.amountCents) return sendJson(res, 422, { error: "amount_exceeds_transaction" });
      const entry: PaymentsRefundLogEntry = { ...refund, externalRefundId: `re_${randomUUID()}`, status: "accepted", receivedAt: new Date().toISOString() };
      await refundLog.append(entry);
      log(`POST /refunds accepted refundId=${entry.refundId} transactionId=${entry.transactionId} amountCents=${entry.amountCents} externalRefundId=${entry.externalRefundId}`);
      return sendJson(res, 201, { externalRefundId: entry.externalRefundId, status: entry.status, receivedAt: entry.receivedAt });
    }

    if (req.method === "GET" && url.pathname === "/refunds/log") return sendJson(res, 200, { items: await refundLog.list() });

    return sendJson(res, 404, { error: "not_found" });
  }

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const code = err instanceof SyntaxError ? 400 : err instanceof Error && err.message === "body_too_large" ? 413 : 500;
      if (code === 500) console.error("payments-mock error:", err instanceof Error ? err.name : typeof err);
      if (!res.headersSent) sendJson(res, code, { error: code === 500 ? "internal_error" : "bad_request" });
    });
  });
}
