/**
 * TypeScript shapes for Circle's REST API (Gateway / Web3 Services).
 *
 * These mirror the real request/response envelopes documented at
 * https://developers.circle.com. Circle wraps every successful response in a
 * top-level `{ data: ... }` object and reports failures with `{ code, message }`.
 */

/** Payment currencies a merchant can accept at checkout. */
export type CircleCheckoutCurrency = "USD" | "USDC";

/** On-chain settlement currency Circle pays out / settles in. */
export type CircleSettlementCurrency = "USDC";

/**
 * Supported settlement chains. Circle uses lowercase chain identifiers in its
 * REST API (e.g. "ETH", "MATIC", "ARB", "BASE"). We accept the canonical
 * identifiers Circle documents for payment intents.
 */
export type CircleChain = "ETH" | "MATIC" | "ARB" | "BASE" | "AVAX" | "SOL" | "ARC";

/** Lifecycle status of a Circle payment intent. */
export type CirclePaymentIntentStatus =
  | "created"
  | "pending"
  | "complete"
  | "expired"
  | "failed";

/** Lifecycle status of a Circle payout. */
export type CirclePayoutStatus = "pending" | "complete" | "failed";

/** Lifecycle status of a Circle transfer. */
export type CircleTransferStatus = "pending" | "complete" | "failed";

/** An amount as Circle represents it: decimal string + ISO currency code. */
export interface CircleAmount {
  amount: string;
  currency: string;
}

/** The `paymentMethods` array entry Circle echoes back on a payment intent. */
export interface CirclePaymentMethod {
  type: "blockchain";
  chain: CircleChain;
}

/** Raw payment-intent resource as returned by Circle (inside `data`). */
export interface CirclePaymentIntentResource {
  id: string;
  amount: CircleAmount;
  amountPaid?: CircleAmount;
  settlementCurrency: CircleSettlementCurrency;
  paymentMethods: CirclePaymentMethod[];
  status: CirclePaymentIntentStatus;
  createDate: string;
  updateDate: string;
  expiresOn?: string;
  merchantId?: string;
  merchantWalletId?: string;
}

/** Raw payout resource as returned by Circle (inside `data`). */
export interface CirclePayoutResource {
  id: string;
  amount: CircleAmount;
  fees?: CircleAmount;
  status: CirclePayoutStatus;
  sourceWalletId: string;
  destination: CirclePayoutDestination;
  createDate: string;
  updateDate: string;
  trackingRef?: string;
}

/** Destination descriptor for a payout (a blockchain address / chain). */
export interface CirclePayoutDestination {
  type: "blockchain";
  address: string;
  chain: CircleChain;
}

/** Raw transfer resource as returned by Circle (inside `data`). */
export interface CircleTransferResource {
  id: string;
  source: CircleTransferEndpoint;
  destination: CircleTransferEndpoint;
  amount: CircleAmount;
  status: CircleTransferStatus;
  transactionHash?: string;
  createDate: string;
}

/** A wallet/blockchain endpoint on a transfer. */
export interface CircleTransferEndpoint {
  type: "wallet" | "blockchain";
  id?: string;
  address?: string;
  chain?: CircleChain;
}

/** Circle's success envelope: `{ data: T }`. */
export interface CircleEnvelope<T> {
  data: T;
}

/** Circle's error envelope: `{ code, message }`, sometimes with `errors`. */
export interface CircleErrorBody {
  code?: number | string;
  message?: string;
  errors?: Array<{
    error?: string;
    message?: string;
    location?: string;
    invalidValue?: unknown;
    constraints?: Record<string, unknown>;
  }>;
}
