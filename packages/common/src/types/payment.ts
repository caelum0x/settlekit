import type { Money } from "../money.js";

/**
 * Every network a buyer can settle on. EVM networks settle a 6-decimal
 * stablecoin (see @settlekit/chains for the per-chain token); Solana settles
 * USDC; Zcash settles ZEC to a transparent address at a locked USD quote.
 */
export type PaymentNetwork =
  | "solana"
  | "base"
  | "arc"
  | "ethereum"
  | "arbitrum"
  | "robinhood"
  | "hyperevm"
  | "tempo"
  | "zcash";

/** Every {@link PaymentNetwork}, in display order. */
export const PAYMENT_NETWORKS: readonly PaymentNetwork[] = [
  "solana",
  "base",
  "arc",
  "ethereum",
  "arbitrum",
  "robinhood",
  "hyperevm",
  "tempo",
  "zcash",
];

/** True when `value` names a supported {@link PaymentNetwork}. */
export function isPaymentNetwork(value: string): value is PaymentNetwork {
  return (PAYMENT_NETWORKS as readonly string[]).includes(value);
}

/**
 * A non-USD settlement locked at session creation (Zcash). The buyer owes
 * exactly `amountBase` base units of `asset` until `expiresAt`.
 */
export interface SettlementQuote {
  asset: "ZEC";
  /** Integer base units owed (zatoshis for ZEC), as a decimal string. */
  amountBase: string;
  /** Base-unit decimals of `asset` (8 for ZEC). */
  decimals: 8;
  /** USD price of one `asset` used for the quote, decimal string. */
  rate: string;
  /** Price source that produced `rate` (e.g. "coinbase", "kraken"). */
  source: string;
  /** ISO timestamp the quote was locked. */
  lockedAt: string;
  /** ISO timestamp after which the quote no longer binds. */
  expiresAt: string;
}

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
  /**
   * Solana Pay reference (base58 32-byte key) the payment transaction must
   * include, binding the on-chain transfer to this session. Solana only.
   */
  paymentReference?: string;
  /** Locked non-USD quote the buyer must pay (Zcash sessions only). */
  settlementQuote?: SettlementQuote;
  /**
   * Wallet the buyer declared they pay from. When set, the on-chain transfer
   * must originate from it (payer binding).
   */
  payerAddress?: string;
  /** Networks the buyer may choose between (defaults to `[network]`). */
  acceptedNetworks?: PaymentNetwork[];
  /** Per-network payTo override; `payToAddress` applies to `network`. */
  payToByNetwork?: Partial<Record<PaymentNetwork, string>>;
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
