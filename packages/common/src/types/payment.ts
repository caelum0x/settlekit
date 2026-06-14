import type { Money } from "../money.js";

export type PaymentNetwork = "arc" | "base" | "ethereum";

export type CheckoutSessionStatus = "open" | "completed" | "expired" | "canceled";

export interface CheckoutLineItem {
  productId?: string;
  bundleId?: string;
  priceId: string;
  quantity: number;
}

export interface CheckoutSession {
  id: string;
  organizationId: string;
  merchantId: string;
  customerId?: string;
  lineItems: CheckoutLineItem[];
  amount: Money;
  status: CheckoutSessionStatus;
  /** Address the buyer must pay to (merchant payout wallet or gateway). */
  payToAddress: string;
  network: PaymentNetwork;
  successUrl?: string;
  cancelUrl?: string;
  /** ISO timestamp after which the session can no longer be paid. */
  expiresAt: string;
  /** Buyer-supplied delivery inputs (github username, discord id, etc.). */
  collectedFields: Record<string, string>;
  createdAt: string;
}

export type PaymentStatus = "pending" | "confirmed" | "failed" | "refunded";

export interface Payment {
  id: string;
  organizationId: string;
  checkoutSessionId: string;
  customerId: string;
  amount: Money;
  network: PaymentNetwork;
  /** On-chain transaction hash once observed. */
  txHash?: string;
  /** Number of confirmations observed by the indexer. */
  confirmations: number;
  status: PaymentStatus;
  createdAt: string;
  confirmedAt?: string;
}

export type SubscriptionStatus = "active" | "past_due" | "canceled" | "expired" | "in_grace";

export interface Subscription {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  priceId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  /** Grace window end after a missed renewal before access is revoked. */
  graceEndsAt?: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export interface UsageMeter {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  /** Metric name, e.g. "api_calls". */
  metric: string;
  /** Aggregated count within the current period. */
  value: number;
  periodStart: string;
  periodEnd: string;
}

export interface CreditBalance {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  creditsRemaining: number;
  creditsGranted: number;
  updatedAt: string;
}
