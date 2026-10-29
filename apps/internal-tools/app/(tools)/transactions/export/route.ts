import { prisma } from "@fintech/models";
import { toCsv } from "@fintech/platform";
import { audit, requireRole, route } from "@fintech/platform/server";
import type { NextRequest } from "next/server";
import { TRANSACTIONS_ROLES } from "@/lib/catalog";
import { EXPORT_LIMIT, buildTxnWhere, parseTxnFilters, resolveCustomers, txnSelect, type TxnRow } from "../_lib/search";

export const dynamic = "force-dynamic";

/**
 * CSV export of the current search (same filters as the page), capped at EXPORT_LIMIT rows.
 * The export contains no PII fields (ssn, dob, address, documentNumber), so it is identical for
 * every role. The export itself is audited with its filters and row count.
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireRole(TRANSACTIONS_ROLES);
  const filters = parseTxnFilters(Object.fromEntries(req.nextUrl.searchParams));
  const match = await resolveCustomers(filters.customer);
  const rows: TxnRow[] =
    match && match.ids.length === 0
      ? []
      : await prisma.transaction.findMany({ where: buildTxnWhere(filters, match?.ids), select: txnSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: EXPORT_LIMIT });
  await audit(user, {
    action: "transaction.export",
    entityType: "Transaction",
    entityId: "export",
    metadata: { filters, rowCount: rows.length, truncated: rows.length === EXPORT_LIMIT, customerMatchTruncated: match?.truncated ?? false },
  });
  const csv = toCsv(rows, [
    { header: "transaction_id", value: (r) => r.id },
    { header: "created_at", value: (r) => r.createdAt },
    { header: "customer_id", value: (r) => r.customerId },
    { header: "customer_name", value: (r) => r.customer.name },
    { header: "merchant", value: (r) => r.merchant },
    { header: "merchant_category_code", value: (r) => r.merchantCategoryCode },
    { header: "amount_cents", value: (r) => r.amountCents },
    { header: "currency", value: (r) => r.currency },
    { header: "status", value: (r) => r.status },
    { header: "device_id", value: (r) => r.deviceId },
    { header: "card_fingerprint", value: (r) => r.cardFingerprint },
  ]);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
