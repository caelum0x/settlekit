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
  /**
   * On-chain transaction that returned the funds, as reported by the
   * merchant (merchants refund from their own wallet; not re-verified).
   */
  txHash?: string;
  /** Wallet the refund is sent to (refund-to-payer flow). */
  destination?: string;
  /** Network the refund is sent on (the payment's network). */
  network?: string;
  /** Solana Pay reference the refund transaction must include. */
  reference?: string;
  /** manual = recorded tx; wallet = prepared, signed and verified onchain. */
  source?: "manual" | "wallet";
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
