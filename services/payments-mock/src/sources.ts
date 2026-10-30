import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma, type Prisma } from "@fintech/models";
import type { PaymentsRefundLogEntry, PaymentsTransaction } from "@fintech/models/payments";
import type { RefundLog, TransactionSource } from "./server";

type TxnRow = Prisma.TransactionGetPayload<{ include: { customer: { select: { name: true } } } }>;

function toDto(t: TxnRow): PaymentsTransaction {
  return {
    id: t.id,
    customerId: t.customerId,
    customerName: t.customer.name,
    amountCents: t.amountCents,
    currency: t.currency,
    merchant: t.merchant,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Transactions backed by the product database (the "ledger" in this mock). */
export const prismaTransactionSource: TransactionSource = {
  async search({ q, customerId, page = 1, pageSize = 25 }) {
    const where: Prisma.TransactionWhereInput = {
      ...(customerId ? { customerId } : {}),
      ...(q ? { OR: [{ id: q }, { customerId: q }, { customer: { name: { startsWith: q, mode: "insensitive" } } }] } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.transaction.findMany({
        where,
        include: { customer: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.transaction.count({ where }),
    ]);
    return { items: rows.map(toDto), page, pageSize, total };
  },
  async get(id) {
    const row = await prisma.transaction.findUnique({ where: { id }, include: { customer: { select: { name: true } } } });
    return row ? toDto(row) : null;
  },
};

/** Append-only JSONL refund log (the "payments-mock log"). */
export async function createFileRefundLog(file: string): Promise<RefundLog> {
  await mkdir(path.dirname(file), { recursive: true });
  const entries: PaymentsRefundLogEntry[] = [];
  try {
    for (const line of (await readFile(file, "utf8")).split("\n")) if (line.trim()) entries.push(JSON.parse(line) as PaymentsRefundLogEntry);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return {
    async append(entry) {
      await appendFile(file, `${JSON.stringify(entry)}\n`);
      entries.push(entry);
    },
    async find(refundId) {
      return entries.find((e) => e.refundId === refundId);
    },
    async list() {
      return [...entries];
    },
  };
}

export function createMemoryRefundLog(): RefundLog {
  const entries: PaymentsRefundLogEntry[] = [];
  return {
    async append(entry) {
      entries.push(entry);
    },
    async find(refundId) {
      return entries.find((e) => e.refundId === refundId);
    },
    async list() {
      return [...entries];
    },
  };
}
