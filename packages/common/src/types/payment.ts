import type { Money } from "../money.js";

/**
 * Every network a buyer can settle on. EVM networks settle a 6-decimal
 * stablecoin (see @settlekit/chains for the per-chain token); Solana settles
 * USDC; HyperCore settles perps-account USDC through Hyperliquid `usdSend`;
 * Zcash settles ZEC to a transparent address at a locked USD quote.
 */
export type PaymentNetwork =
  | "solana"
  | "base"
  | "arc"
  | "ethereum"
  | "arbitrum"
  | "robinhood"
  | "hyperevm"
  | "hypercore"
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
  "hypercore",
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

/** Route provider that moved a buyer's funds from another chain/token. */
export type RouteProviderName = "relay" | "lifi";

/**
 * Lifecycle of an any-token route. `success` only means the PROVIDER reports
 * a fill; the session is paid only once the destination transfer passes the
 * fail-closed verifier for the session's network.
 */
export type RouteState = "quoted" | "waiting" | "pending" | "success" | "refund" | "failure";

/**
 * An any-token payment route (pay with any token on any chain; the merchant
 * receives the session's stablecoin on the session's network). Stored for UX,
 * status polling and refunds only — never trusted for fulfilment.
 */
export interface CheckoutRoute {
  provider: RouteProviderName;
  /** Provider request id (Relay requestId / LI.FI quote id). */
  requestId: string;
  /** Destination network the route was quoted for. */
  network: PaymentNetwork;
  /** Provider chain id + token the buyer pays with. */
  originChainId: number;
  originToken: string;
  /** Origin amount in origin-token base units (quoted). */
  originAmount: string;
  /** Buyer's origin wallet (also the refund address). */
  originAddress: string;
  /** Origin transaction reported by the buyer's wallet (LI.FI status needs it). */
  originTxHash?: string;
  /** Relay deposit-address mode: where the buyer sends funds. */
  depositAddress?: string;
  /** ISO time the quote was taken and when it stops binding. */
  quotedAt: string;
  expiresAt: string;
  state: RouteState;
  /** Destination fill reported by the provider (still verified on-chain). */
  destinationTxHash?: string;
  /** Refund transaction(s) on the origin chain, when the route refunded. */
  refundTxHash?: string;
  /** Provider failure detail, for support. */
  detail?: string;
  updatedAt?: string;
}

export type CheckoutSessionStatus = "open" | "completed" | "expired" | "canceled";

export interface CheckoutLineItem {
  productId?: string;
  bundleId?: string;
  priceId: string;
  quantity: number;
}

/** A coupon applied to a checkout session. */
export interface CheckoutDiscount {
  couponCode: string;
  subtotal: Money;
  amountOff: Money;
  /** Set once the redemption was counted (after the payment confirmed). */
  redeemedAt?: string;
}

/** Tax applied to a checkout session. */
export interface CheckoutTax {
  /** Price after discount, before tax. */
  net: Money;
  amount: Money;
  rateBps: number;
  jurisdiction: string;
  label: string;
  reverseCharge: boolean;
  country?: string;
  vatId?: string;
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
  /**
   * HyperCore: the usdSend this checkout submitted (signer + signed action
   * time/nonce), persisted at submit so status polls match exactly that
   * action; `hash` once the ledger entry was found (later polls look it up
   * by hash).
   */
  hypercoreSubmission?: { sender: string; nonce: number; hash?: string };
  /** Networks the buyer may choose between (defaults to `[network]`). */
  acceptedNetworks?: PaymentNetwork[];
  /** Per-network payTo override; `payToAddress` applies to `network`. */
  payToByNetwork?: Partial<Record<PaymentNetwork, string>>;
  /**
   * Tempo: a direct payment must be a TIP-20 `transferWithMemo` carrying
   * keccak256(session id). Set when the merchant requires it or the buyer
   * pays through the checkout wallet flow (which always sends the memo).
   */
  requireMemo?: boolean;
  /** Any-token route in progress (see {@link CheckoutRoute}). */
  route?: CheckoutRoute;
  /** Invoice this session pays (invoices and payment requests). */
  invoiceId?: string;
  /**
   * Promo code applied to this session. `amount` is already the discounted
   * total (what the verifier expects on-chain); `subtotal` is the list total.
   */
  discount?: CheckoutDiscount;
  /**
   * Tax charged on top of the net price (after any discount). `amount` is
   * net + tax; the buyer's billing country / VAT ID pick the rate.
   */
  tax?: CheckoutTax;
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
