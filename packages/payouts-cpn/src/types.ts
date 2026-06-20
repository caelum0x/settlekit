/**
 * Creator fiat off-ramp primitives (Circle Payments Network).
 *
 * An {@link OffRampProvider} converts a creator's USDC balance into a fiat
 * payout to a bank account. The same interface is implemented by a real CPN
 * provider (live HTTP behind an injected client) and a deterministic in-memory
 * provider used for tests and demos — so callers wire one configurable seam and
 * flip backends by environment, exactly like @settlekit/settlement-core's
 * {@link SettlementProvider}.
 *
 * Convention (mirrors settlement-core):
 *  - Expected, business-level failures (validation, expiry, conflict) are
 *    returned as `err(...)` inside a {@link Result}.
 *  - Configuration / programmer errors (missing credentials) are THROWN as a
 *    {@link SettleKitError}, never returned.
 */

import type { IsoTimestamp, Money, PaymentNetwork, Result } from "@settlekit/common";

/** Which backend produced a quote/receipt. */
export type OffRampProviderName = "cpn" | "local";

/** Lifecycle of a fiat payout. */
export type PayoutStatus = "pending" | "submitted" | "paid" | "failed" | "returned";

/** Supported payout rails. Extensible union — only `bank_account` today. */
export type PayoutMethod = "bank_account";

/** A request for an indicative off-ramp quote. */
export interface OffRampQuoteRequest {
  /** Business idempotency / correlation key. */
  reference: string;
  /** Source amount, decimal USDC string. */
  amountUsdc: string;
  /** ISO-4217 fiat currency to receive, e.g. "USD". */
  destinationCurrency: string;
  payoutMethod: PayoutMethod;
  /** Beneficiary country, ISO-3166 alpha-2 (e.g. "US"). */
  beneficiaryCountry: string;
}

/** An indicative quote: how much fiat a USDC amount converts to, with fees. */
export interface OffRampQuote {
  id: string;
  reference: string;
  /** The USDC amount being off-ramped. */
  sourceAmount: Money;
  /** ISO-4217 destination currency. */
  destinationCurrency: string;
  /** Conversion rate as a decimal string (destination per 1 USDC). */
  rate: string;
  /** Resulting fiat amount as a decimal string in the destination currency. */
  destinationAmount: string;
  /** The fee charged, denominated in USDC. */
  feeUsdc: Money;
  /** When this quote stops being honoured. */
  expiresAt: IsoTimestamp;
  provider: OffRampProviderName;
}

/** The bank account a payout settles into. */
export interface Beneficiary {
  name: string;
  /** ISO-3166 alpha-2 country code. */
  country: string;
  accountNumber: string;
  /** Routing / sort code where the rail requires it (US ACH, etc.). */
  routingNumber?: string;
}

/** A request to actually move money off-ramp to a beneficiary. */
export interface PayoutRequest {
  /** Business idempotency key — the same reference must never pay out twice. */
  reference: string;
  /** Optional quote to honour; when absent the provider quotes inline. */
  quoteId?: string;
  /** Source amount, decimal USDC string. */
  amountUsdc: string;
  /** ISO-4217 destination currency. */
  destinationCurrency: string;
  payoutMethod: PayoutMethod;
  beneficiary: Beneficiary;
  /** On-chain network the source USDC is drawn from, if it must be specified. */
  sourceNetwork?: PaymentNetwork;
  /** Optional human-readable note for audit/metrics. */
  memo?: string;
}

/** The outcome of an off-ramp payout. */
export interface PayoutReceipt {
  id: string;
  reference: string;
  /** Source amount in USDC. */
  amount: Money;
  /** ISO-4217 destination currency. */
  destinationCurrency: string;
  /** Fiat amount delivered, decimal string in the destination currency. */
  destinationAmount: string;
  status: PayoutStatus;
  provider: OffRampProviderName;
  /** Circle Payments Network transfer id once known. */
  cpnTransferId?: string;
  /** Reason when status is "failed" or "returned". */
  failureReason?: string;
  createdAt: IsoTimestamp;
  settledAt?: IsoTimestamp;
}

/** A pluggable creator fiat off-ramp backend. */
export interface OffRampProvider {
  readonly name: OffRampProviderName;
  quote(req: OffRampQuoteRequest): Promise<Result<OffRampQuote>>;
  initiatePayout(req: PayoutRequest): Promise<Result<PayoutReceipt>>;
  getPayoutStatus(reference: string): Promise<Result<PayoutReceipt>>;
}

/**
 * Records reference -> receipt so a retried payout is a no-op. Mirrors
 * settlement-core's IdempotencyStore so {@link withPayoutIdempotency} can be
 * TOCTOU-safe across processes.
 */
export interface PayoutStore {
  get(reference: string): Promise<PayoutReceipt | undefined>;
  put(receipt: PayoutReceipt): Promise<void>;
  /**
   * Atomically record a `pending` receipt iff its `reference` is unclaimed,
   * returning `true` when THIS caller won the claim (and must perform the
   * payout) and `false` when another caller already holds it. Without an atomic
   * claim, two concurrent requests with the same reference both pass a
   * get()-then-pay() check and double-pay. Optional — stores that omit it fall
   * back to non-atomic get/put.
   */
  reserve?(pending: PayoutReceipt): Promise<boolean>;
  /**
   * Drop a `pending` claim so a later retry of a *failed* payout can proceed.
   * Only removes a claim still in `pending` status.
   */
  release?(reference: string): Promise<void>;
}
