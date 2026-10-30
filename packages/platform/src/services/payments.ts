import type {
  PaymentsRefundRequest,
  PaymentsRefundResponse,
  PaymentsTransactionPage,
  PaymentsTransactionQuery,
} from "@fintech/models/payments";
import { PlatformError } from "../errors";
import { outboundFetch } from "../outbound";

export interface PaymentsClient {
  searchTransactions(query: PaymentsTransactionQuery): Promise<PaymentsTransactionPage>;
  createRefund(request: PaymentsRefundRequest): Promise<PaymentsRefundResponse>;
}

export class PaymentsServiceError extends PlatformError {
  constructor(message: string) {
    super(message, 502, "payments_unavailable");
  }
}

export function createPaymentsClient(baseUrl: string, token: string): PaymentsClient {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await outboundFetch(`${baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
    });
    if (!res.ok) throw new PaymentsServiceError(`payments-mock responded ${res.status} for ${path.split("?")[0]}`);
    return (await res.json()) as T;
  }
  return {
    searchTransactions(query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
      return call(`/transactions?${params.toString()}`);
    },
    createRefund(request) {
      return call("/refunds", { method: "POST", body: JSON.stringify(request) });
    },
  };
}

export function paymentsClient(): PaymentsClient {
  return createPaymentsClient(process.env.PAYMENTS_MOCK_URL ?? "http://localhost:4100", process.env.PAYMENTS_MOCK_TOKEN ?? "");
}
