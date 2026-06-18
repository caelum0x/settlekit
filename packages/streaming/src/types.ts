/**
 * Streaming (continuous-authorization) payment types.
 *
 * The viewer authorizes a *rate* (USDC/second) and a *reserve* (the maximum to
 * commit), instead of a fixed price. Value accrues in real time as the stream
 * is consumed, settles in batches, pauses on a delivery drop, and refunds the
 * reserved-but-unused remainder when the stream stops. The unit of a live
 * performance is the second, so the unit of paying for it is too (RFB 4).
 */

import type { IsoTimestamp, Money, PaymentNetwork } from "@settlekit/common";

export type StreamState = "active" | "paused" | "stopped";

/** Why a stream is currently paused (for proof-of-flow vs manual). */
export type PauseReason = "manual" | "flow";

/** Options to open a {@link PaymentStream}. */
export interface OpenStreamInput {
  /** Optional explicit id. */
  id?: string;
  /** Payer (viewer) address/identifier. */
  payer: string;
  /** Payee (streamer) address/identifier. */
  payee: string;
  network: PaymentNetwork;
  /** Authorized rate, decimal USDC per second (e.g. "0.0001"). */
  ratePerSecondUsdc: string;
  /** Maximum total committed up front, decimal USDC. Accrual is capped here. */
  reserveUsdc: string;
  /** Epoch-millisecond clock. Injectable for testing. Defaults to Date.now. */
  now?: () => number;
}

/** A single batched settlement of accrued value. */
export interface StreamSettlement {
  streamId: string;
  /** Amount settled in this batch. */
  amount: Money;
  /** Cumulative settled total after this batch. */
  settledTotal: Money;
  at: IsoTimestamp;
}

/** Sink invoked for each batched settlement (wire to Gateway batching, a
 * ledger, or revenue splits). */
export type StreamSettleSink = (settlement: StreamSettlement) => void | Promise<void>;

/** An immutable view of a stream's meter. */
export interface StreamSnapshot {
  id: string;
  state: StreamState;
  pauseReason?: PauseReason;
  ratePerSecondUsdc: string;
  reserveUsdc: string;
  /** Total value accrued so far (capped at the reserve). */
  accruedUsdc: string;
  /** Total value already settled in batches. */
  settledUsdc: string;
  /** Accrued but not yet settled. */
  dueUsdc: string;
  /** Reserved-but-unused remainder (refundable on stop). */
  refundableUsdc: string;
}
