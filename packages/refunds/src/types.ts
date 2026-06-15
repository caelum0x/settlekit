import type { IsoTimestamp, Money } from "@settlekit/common";

/** Why a refund was issued. */
export type RefundReason =
  | "duplicate"
  | "fraudulent"
  | "customer_request"
  | "delivery_failed";

/** Lifecycle of a refund. */
export type RefundStatus = "pending" | "succeeded" | "failed";

/**
 * A refund against a confirmed payment. Refunds may be partial (amount less
 * than the original payment) or full (amount equal to it). The aggregate of
 * all non-failed refunds against a payment can never exceed the payment.
 */
export interface Refund {
  id: string;
  paymentId: string;
  customerId: string;
  amount: Money;
  reason: RefundReason;
  status: RefundStatus;
  /** Set when the refund settled or failed. */
  failureReason?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
