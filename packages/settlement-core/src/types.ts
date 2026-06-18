/**
 * Production settlement primitives.
 *
 * A {@link SettlementProvider} performs one idempotent USDC transfer to an
 * address on a network and returns a {@link SettlementReceipt}. The same
 * interface is implemented by Gateway (batched nanopayments), Circle
 * programmable wallets, and a local in-memory provider (tests/dev) — so every
 * module (citation tolls, streaming, agent payments) settles through one
 * configurable seam.
 */

import type { IsoTimestamp, Money, PaymentNetwork } from "@settlekit/common";

export type SettlementStatus = "pending" | "submitted" | "settled" | "failed";

/** Which backend produced a receipt. */
export type SettlementProviderName = "gateway" | "circle" | "local";

/** A request to move USDC to one recipient. `reference` is the business
 * idempotency key — the same reference must never settle twice. */
export interface SettlementRequest {
  /** Idempotency / business key (e.g. `citation:<id>:<nonce>`). */
  reference: string;
  /** Recipient address. */
  to: string;
  /** Amount, decimal USDC string. */
  amountUsdc: string;
  network: PaymentNetwork;
  /** Optional human-readable note for audit/metrics. */
  memo?: string;
}

/** The outcome of a settlement. */
export interface SettlementReceipt {
  id: string;
  reference: string;
  to: string;
  amount: Money;
  network: PaymentNetwork;
  status: SettlementStatus;
  provider: SettlementProviderName;
  /** On-chain transaction hash once known. */
  txHash?: string;
  /** Gateway batch id when settled as part of a batch. */
  batchId?: string;
  /** Failure reason when status is "failed". */
  failureReason?: string;
  createdAt: IsoTimestamp;
  settledAt?: IsoTimestamp;
}

/** A pluggable settlement backend. */
export interface SettlementProvider {
  readonly name: SettlementProviderName;
  settle(request: SettlementRequest): Promise<SettlementReceipt>;
}

/** Records reference -> receipt so a retried settlement is a no-op. */
export interface IdempotencyStore {
  get(reference: string): Promise<SettlementReceipt | undefined>;
  put(receipt: SettlementReceipt): Promise<void>;
}

/** A queryable receipt store (the settlement worker reconciles by status). */
export interface SettlementReceiptStore extends IdempotencyStore {
  listByStatus(status: SettlementStatus): Promise<SettlementReceipt[]>;
}

/** Issues and consumes one-time nonces for x402 replay protection. */
export interface NonceStore {
  issue(): Promise<string>;
  /** Returns true exactly once per nonce (false if unknown/already consumed). */
  consume(nonce: string): Promise<boolean>;
}
