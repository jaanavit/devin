// Wire contract for services/payments-mock. Shared by the service and its clients.

export interface PaymentsTransaction {
  id: string;
  customerId: string;
  customerName: string;
  amountCents: number;
  currency: string;
  merchant: string;
  status: string;
  createdAt: string;
}

export interface PaymentsTransactionPage {
  items: PaymentsTransaction[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PaymentsTransactionQuery {
  /** Matches transaction ID, customer ID, or customer name (prefix, case-insensitive). */
  q?: string;
  customerId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaymentsRefundRequest {
  /** Idempotency key: the platform Refund.id. */
  refundId: string;
  transactionId: string;
  amountCents: number;
}

export interface PaymentsRefundResponse {
  externalRefundId: string;
  status: "accepted";
  receivedAt: string;
}

export interface PaymentsRefundLogEntry extends PaymentsRefundRequest, PaymentsRefundResponse {}
