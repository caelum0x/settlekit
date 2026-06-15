/**
 * Payments resource client. Maps to `/v1/payments`.
 *
 * Confirming a payment completes its checkout session and grants one
 * entitlement per line-item product — that combined result is returned.
 */
import type { Payment, Entitlement } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link PaymentsResource.record}. */
export interface RecordPaymentInput {
  checkoutSessionId: string;
  txHash?: string;
}

/** Input for {@link PaymentsResource.confirm}. */
export interface ConfirmPaymentInput {
  txHash: string;
  confirmations: number;
  minConfirmations?: number;
}

/** Result of confirming a payment: the payment plus granted entitlements. */
export interface ConfirmPaymentResult {
  payment: Payment;
  entitlements: Entitlement[];
}

/** Client for payment endpoints. */
export class PaymentsResource {
  constructor(private readonly http: HttpClient) {}

  /** Record a pending payment against a checkout session. */
  record(input: RecordPaymentInput, options?: RequestOptions): Promise<Payment> {
    return this.http.post<Payment>("/v1/payments", input, options);
  }

  /** Retrieve a payment by id. */
  retrieve(id: string, options?: RequestOptions): Promise<Payment> {
    return this.http.get<Payment>(`/v1/payments/${encodeURIComponent(id)}`, options);
  }

  /** Confirm a payment; completes the session and grants entitlements. */
  confirm(id: string, input: ConfirmPaymentInput, options?: RequestOptions): Promise<ConfirmPaymentResult> {
    return this.http.post<ConfirmPaymentResult>(
      `/v1/payments/${encodeURIComponent(id)}/confirm`,
      input,
      options,
    );
  }

  /** Mark a pending payment as failed. */
  fail(id: string, options?: RequestOptions): Promise<Payment> {
    return this.http.post<Payment>(`/v1/payments/${encodeURIComponent(id)}/fail`, undefined, options);
  }

  /** Refund a confirmed payment. */
  refund(id: string, options?: RequestOptions): Promise<Payment> {
    return this.http.post<Payment>(`/v1/payments/${encodeURIComponent(id)}/refund`, undefined, options);
  }
}
