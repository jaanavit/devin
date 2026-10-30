import { prisma, type KycCase, type Refund, type Transaction } from "@fintech/models";

// ---------------------------------------------------------------------------
// Timeline: one ordered stream of transactions, refunds and KYC events.
// ---------------------------------------------------------------------------

export type TimelineSource = "transaction" | "refund" | "kyc";

export interface TimelineEvent {
  /** Stable unique key: `<source>:<entity id>:<event>`. */
  key: string;
  at: Date;
  source: TimelineSource;
  title: string;
  entityId: string;
  amountCents?: number;
  status?: string;
  href?: string;
}

type TxnInput = Pick<Transaction, "id" | "createdAt" | "amountCents" | "merchant" | "status">;
type RefundInput = Pick<Refund, "id" | "createdAt" | "processedAt" | "amountCents" | "status" | "transactionId">;
type KycInput = Pick<KycCase, "id" | "openedAt" | "claimedAt" | "recommendedAt" | "recommendation" | "decidedAt" | "decision" | "status">;

/**
 * Merges the three sources into one list, newest first. Ties are broken by source order
 * (KYC, refund, transaction) and then key, so the order is deterministic.
 */
export function buildTimeline(txns: readonly TxnInput[], refunds: readonly RefundInput[], kycCases: readonly KycInput[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const t of txns) {
    events.push({ key: `transaction:${t.id}:created`, at: t.createdAt, source: "transaction", title: `Transaction at ${t.merchant}`, entityId: t.id, amountCents: t.amountCents, status: t.status });
  }
  for (const r of refunds) {
    events.push({ key: `refund:${r.id}:requested`, at: r.createdAt, source: "refund", title: `Refund requested for ${r.transactionId}`, entityId: r.id, amountCents: r.amountCents, status: r.status, href: `/refunds/${r.id}` });
    if (r.processedAt) {
      events.push({ key: `refund:${r.id}:processed`, at: r.processedAt, source: "refund", title: "Refund paid out", entityId: r.id, amountCents: r.amountCents, status: "PROCESSED", href: `/refunds/${r.id}` });
    }
  }
  for (const k of kycCases) {
    const href = `/kyc/${k.id}`;
    events.push({ key: `kyc:${k.id}:opened`, at: k.openedAt, source: "kyc", title: "KYC case opened", entityId: k.id, href });
    if (k.claimedAt) events.push({ key: `kyc:${k.id}:claimed`, at: k.claimedAt, source: "kyc", title: "KYC case claimed by an analyst", entityId: k.id, href });
    if (k.recommendedAt) {
      events.push({ key: `kyc:${k.id}:recommended`, at: k.recommendedAt, source: "kyc", title: `KYC recommendation: ${k.recommendation?.toLowerCase() ?? "—"}`, entityId: k.id, href });
    }
    if (k.decidedAt) {
      events.push({ key: `kyc:${k.id}:decided`, at: k.decidedAt, source: "kyc", title: `KYC decision: ${k.decision?.toLowerCase() ?? "—"}`, entityId: k.id, status: k.status, href });
    }
  }
  const rank: Record<TimelineSource, number> = { kyc: 0, refund: 1, transaction: 2 };
  return events.sort((a, b) => b.at.getTime() - a.at.getTime() || rank[a.source] - rank[b.source] || a.key.localeCompare(b.key));
}

/** Most recent transactions shown on the customer timeline (all refunds and KYC events are always included). */
export const TIMELINE_TXN_LIMIT = 200;

export async function loadTimeline(customerId: string): Promise<{ events: TimelineEvent[]; txnTotal: number }> {
  const [txns, txnTotal, refunds, kycCases] = await Promise.all([
    prisma.transaction.findMany({
      where: { customerId },
      select: { id: true, createdAt: true, amountCents: true, merchant: true, status: true },
      orderBy: { createdAt: "desc" },
      take: TIMELINE_TXN_LIMIT,
    }),
    prisma.transaction.count({ where: { customerId } }),
    prisma.refund.findMany({ where: { customerId }, select: { id: true, createdAt: true, processedAt: true, amountCents: true, status: true, transactionId: true } }),
    prisma.kycCase.findMany({
      where: { customerId },
      select: { id: true, openedAt: true, claimedAt: true, recommendedAt: true, recommendation: true, decidedAt: true, decision: true, status: true },
    }),
  ]);
  return { events: buildTimeline(txns, refunds, kycCases), txnTotal };
}

// ---------------------------------------------------------------------------
// Linked accounts: other customers sharing a device, card, or address hash.
// ---------------------------------------------------------------------------

export type LinkKind = "device" | "card" | "address";

export interface LinkedAccount {
  customerId: string;
  name: string;
  riskLevel: string;
  links: { kind: LinkKind; value: string }[];
}

export interface CustomerIdentifiers {
  devices: string[];
  cards: string[];
  addressHash: string;
}

/** Groups (customer, kind, value) hits into one row per linked customer, strongest links first. */
export function groupLinks(
  self: string,
  hits: readonly { customerId: string; kind: LinkKind; value: string }[],
  customers: ReadonlyMap<string, { name: string; riskLevel: string }>,
): LinkedAccount[] {
  const byCustomer = new Map<string, LinkedAccount>();
  for (const h of hits) {
    if (h.customerId === self) continue;
    const info = customers.get(h.customerId);
    if (!info) continue;
    const row = byCustomer.get(h.customerId) ?? { customerId: h.customerId, name: info.name, riskLevel: info.riskLevel, links: [] };
    if (!row.links.some((l) => l.kind === h.kind && l.value === h.value)) row.links.push({ kind: h.kind, value: h.value });
    byCustomer.set(h.customerId, row);
  }
  return [...byCustomer.values()].sort((a, b) => b.links.length - a.links.length || a.customerId.localeCompare(b.customerId));
}

export const LINKED_ACCOUNT_LIMIT = 100;

export async function loadLinkedAccounts(customerId: string, addressHash: string): Promise<{ identifiers: CustomerIdentifiers; linked: LinkedAccount[] }> {
  const [devices, cards] = await Promise.all([
    prisma.transaction.findMany({ where: { customerId }, distinct: ["deviceId"], select: { deviceId: true } }),
    prisma.transaction.findMany({ where: { customerId }, distinct: ["cardFingerprint"], select: { cardFingerprint: true } }),
  ]);
  const identifiers: CustomerIdentifiers = { devices: devices.map((d) => d.deviceId), cards: cards.map((c) => c.cardFingerprint), addressHash };
  const [byDevice, byCard, byAddress] = await Promise.all([
    identifiers.devices.length
      ? prisma.transaction.findMany({ where: { deviceId: { in: identifiers.devices }, customerId: { not: customerId } }, distinct: ["customerId", "deviceId"], select: { customerId: true, deviceId: true }, take: 1_000 })
      : [],
    identifiers.cards.length
      ? prisma.transaction.findMany({ where: { cardFingerprint: { in: identifiers.cards }, customerId: { not: customerId } }, distinct: ["customerId", "cardFingerprint"], select: { customerId: true, cardFingerprint: true }, take: 1_000 })
      : [],
    prisma.customer.findMany({ where: { addressHash, id: { not: customerId } }, select: { id: true }, take: 1_000 }),
  ]);
  const hits = [
    ...byDevice.map((r) => ({ customerId: r.customerId, kind: "device" as const, value: r.deviceId })),
    ...byCard.map((r) => ({ customerId: r.customerId, kind: "card" as const, value: r.cardFingerprint })),
    ...byAddress.map((r) => ({ customerId: r.id, kind: "address" as const, value: addressHash })),
  ];
  const ids = [...new Set(hits.map((h) => h.customerId))];
  const customers = ids.length
    ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, riskLevel: true } })
    : [];
  const info = new Map(customers.map((c) => [c.id, { name: c.name, riskLevel: c.riskLevel }]));
  return { identifiers, linked: groupLinks(customerId, hits, info).slice(0, LINKED_ACCOUNT_LIMIT) };
}
