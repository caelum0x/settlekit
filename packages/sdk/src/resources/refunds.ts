/**
 * Refunds resource client.
 *
 * Maps to `/v1/refunds`. A refund is created in `pending` against a confirmed
 * payment, then settled with {@link RefundsResource.succeed} or
 * {@link RefundsResource.fail}. The backing payment bounds the refundable
 * amount (the aggregate of non-failed refunds can never exceed it).
 */
import type { Money } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Why a refund was issued. */
export type RefundReason = "duplicate" | "fraudulent" | "customer_request" | "delivery_failed";

/** Lifecycle of a refund. */
export type RefundStatus = "pending" | "succeeded" | "failed";

/** A refund against a confirmed payment, as returned by the API. */
export interface Refund {
  id: string;
  paymentId: string;
  customerId: string;
  amount: Money;
  reason: RefundReason;
  status: RefundStatus;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** Input for {@link RefundsResource.create}. */
export interface CreateRefundInput {
  paymentId: string;
  customerId: string;
  /** Refund amount as a decimal string, e.g. `"10.00"`. */
  amount: string;
  reason: RefundReason;
}

/** Filter for {@link RefundsResource.list}; provide at most one. */
export interface ListRefundsInput {
  paymentId?: string;
  customerId?: string;
}

/** Client for refund endpoints. */
export class RefundsResource {
  constructor(private readonly http: HttpClient) {}

  /** List refunds, optionally filtered by payment or customer. */
  list(filter: ListRefundsInput = {}, options?: RequestOptions): Promise<Refund[]> {
    return this.http.get<Refund[]>("/v1/refunds", {
      ...options,
      query: { ...options?.query, ...filter },
    });
  }

  /** Create a pending refund against a payment. */
  create(input: CreateRefundInput, options?: RequestOptions): Promise<Refund> {
    return this.http.post<Refund>("/v1/refunds", input, options);
  }

  /** Mark a pending refund as succeeded. */
  succeed(id: string, options?: RequestOptions): Promise<Refund> {
    return this.http.post<Refund>(`/v1/refunds/${encodeURIComponent(id)}/succeed`, undefined, options);
  }

  /** Mark a pending refund as failed, with an optional reason. */
  fail(id: string, reason?: string, options?: RequestOptions): Promise<Refund> {
    return this.http.post<Refund>(
      `/v1/refunds/${encodeURIComponent(id)}/fail`,
      reason ? { reason } : undefined,
      options,
    );
  }
}
