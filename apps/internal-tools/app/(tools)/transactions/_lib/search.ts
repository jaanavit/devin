// Transaction search for Risk investigations. Pure parsing + query building, plus the two DB calls
// (customer resolution and the paged search). Kept free of "@/" imports so the benchmark script
// (scripts/bench/transaction-search.ts) can run it directly.
import { prisma, type Prisma } from "@fintech/models";
import { ValidationError, firstParam, parseDollarsToCents, type SearchParams } from "@fintech/platform";

export const TXN_SORTABLE = ["createdAt", "amountCents"] as const;
export type TxnSort = (typeof TXN_SORTABLE)[number];
export const TXN_FILTER_KEYS = ["customer", "txnId", "merchant", "minAmount", "maxAmount", "from", "to"] as const;
export const TXN_STATUSES = ["SETTLED", "PENDING", "DECLINED", "REFUNDED", "PARTIALLY_REFUNDED"] as const;

/** Name-prefix customer searches resolve at most this many customers (the UI warns when capped). */
export const CUSTOMER_MATCH_LIMIT = 500;
export const EXPORT_LIMIT = 50_000;

export interface TxnFilters {
  /** Customer ID (`cus_…`, exact) or customer name prefix (case-insensitive). */
  customer?: string;
  txnId?: string;
  merchant?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
  from?: Date;
  to?: Date;
}

function parseDay(value: string | undefined, endOfDay: boolean, label: string): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${label} must be a date (YYYY-MM-DD)`, "invalid_date");
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${label} is not a valid date`, "invalid_date");
  return d;
}

function parseAmount(value: string | undefined, label: string): number | undefined {
  if (!value) return undefined;
  const cents = parseDollarsToCents(value);
  if (cents === null) throw new ValidationError(`${label} must be a dollar amount, e.g. 125.50`, "invalid_amount");
  return cents;
}

/** Parses and validates URL filters. Throws `ValidationError` with a user-facing message. */
export function parseTxnFilters(sp: SearchParams): TxnFilters {
  const get = (k: string) => firstParam(sp[k])?.trim() || undefined;
  const filters: TxnFilters = {
    customer: get("customer"),
    txnId: get("txnId"),
    merchant: get("merchant"),
    minAmountCents: parseAmount(get("minAmount"), "Min amount"),
    maxAmountCents: parseAmount(get("maxAmount"), "Max amount"),
    from: parseDay(get("from"), false, "From"),
    to: parseDay(get("to"), true, "To"),
  };
  if (filters.minAmountCents !== undefined && filters.maxAmountCents !== undefined && filters.minAmountCents > filters.maxAmountCents) {
    throw new ValidationError("Min amount is greater than max amount", "invalid_range");
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new ValidationError("From is after To", "invalid_range");
  return filters;
}

export function hasAnyFilter(f: TxnFilters): boolean {
  return Object.values(f).some((v) => v !== undefined);
}

/** Builds the `where` for a search. `customerIds` is the resolved customer filter (if any). */
export function buildTxnWhere(f: TxnFilters, customerIds?: readonly string[]): Prisma.TransactionWhereInput {
  const amount = f.minAmountCents !== undefined || f.maxAmountCents !== undefined
    ? { amountCents: { ...(f.minAmountCents !== undefined ? { gte: f.minAmountCents } : {}), ...(f.maxAmountCents !== undefined ? { lte: f.maxAmountCents } : {}) } }
    : {};
  const created = f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {};
  return {
    ...(f.txnId ? { id: f.txnId } : {}),
    ...(customerIds ? { customerId: customerIds.length === 1 ? customerIds[0] : { in: [...customerIds] } } : {}),
    ...(f.merchant ? { merchant: f.merchant } : {}),
    ...amount,
    ...created,
  };
}

export interface CustomerMatch {
  ids: string[];
  truncated: boolean;
}

/** Resolves the customer filter to IDs: exact `cus_…` ID, otherwise a case-insensitive name prefix. */
export async function resolveCustomers(customer: string | undefined): Promise<CustomerMatch | undefined> {
  if (!customer) return undefined;
  if (/^cus_\w+$/.test(customer)) return { ids: [customer], truncated: false };
  const rows = await prisma.customer.findMany({
    where: { name: { startsWith: customer, mode: "insensitive" } },
    select: { id: true },
    orderBy: { id: "asc" },
    take: CUSTOMER_MATCH_LIMIT + 1,
  });
  return { ids: rows.slice(0, CUSTOMER_MATCH_LIMIT).map((r) => r.id), truncated: rows.length > CUSTOMER_MATCH_LIMIT };
}

export const txnSelect = {
  id: true,
  createdAt: true,
  customerId: true,
  amountCents: true,
  currency: true,
  merchant: true,
  merchantCategoryCode: true,
  status: true,
  deviceId: true,
  cardFingerprint: true,
  customer: { select: { name: true } },
} as const satisfies Prisma.TransactionSelect;

export type TxnRow = Prisma.TransactionGetPayload<{ select: typeof txnSelect }>;

export interface TxnSearchResult {
  rows: TxnRow[];
  total: number;
  customerMatch?: CustomerMatch;
}

/** Runs a paged search. Results are always ordered with `id` as a tiebreaker for stable paging. */
export async function searchTransactions(
  f: TxnFilters,
  page: { skip: number; take: number; sort: TxnSort; dir: "asc" | "desc" },
): Promise<TxnSearchResult> {
  const customerMatch = await resolveCustomers(f.customer);
  if (customerMatch && customerMatch.ids.length === 0) return { rows: [], total: 0, customerMatch };
  const where = buildTxnWhere(f, customerMatch?.ids);
  const [rows, total] = await prisma.$transaction([
    prisma.transaction.findMany({ where, select: txnSelect, orderBy: [{ [page.sort]: page.dir }, { id: page.dir }], skip: page.skip, take: page.take }),
    prisma.transaction.count({ where }),
  ]);
  return { rows, total, customerMatch };
}
