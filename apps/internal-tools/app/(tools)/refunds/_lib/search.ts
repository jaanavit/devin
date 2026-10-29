// Transaction search goes through payments-mock (the system of record for transactions).
import type { PaymentsTransactionPage, PaymentsTransactionQuery } from "@fintech/models/payments";
import { PlatformError } from "@fintech/platform";
import { paymentsClient } from "@fintech/platform/server";

export type TransactionSearch = { ok: true; page: PaymentsTransactionPage } | { ok: false; error: string };

/** Searches by transaction ID, customer ID, or customer name prefix. Never throws: the UI shows the error. */
export async function searchTransactions(query: PaymentsTransactionQuery): Promise<TransactionSearch> {
  try {
    return { ok: true, page: await paymentsClient().searchTransactions(query) };
  } catch (err) {
    console.warn(`payments search failed: ${err instanceof PlatformError ? err.code : err instanceof Error ? err.name : typeof err}`);
    return { ok: false, error: "The payments service is unavailable. Try again shortly." };
  }
}
