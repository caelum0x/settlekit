/**
 * A continuous-authorization payment stream.
 *
 * Value accrues at `ratePerSecond` while the stream is `active`, capped at the
 * authorized `reserve`. Paused intervals never accrue. `settle()` batches the
 * accrued-but-unsettled amount; `close()` stops the meter, settles the tail, and
 * returns the refundable remainder. `reportFlow(false)` pauses the meter the
 * instant delivery drops (proof-of-flow), so a viewer pays only for time the
 * stream was actually delivered.
 *
 * The meter is computed in USDC base units with an injectable millisecond clock,
 * so it is exact and fully deterministic under test.
 */

import {
  type IsoTimestamp,
  type Money,
  fromBaseUnits,
  money,
  toBaseUnits,
  toIso,
  uuid,
} from "@settlekit/common";
import type {
  OpenStreamInput,
  PauseReason,
  StreamSettlement,
  StreamSettleSink,
  StreamSnapshot,
  StreamState,
} from "./types.js";

export class PaymentStream {
  readonly id: string;
  readonly payer: string;
  readonly payee: string;
  readonly network: OpenStreamInput["network"];

  private readonly rateBasePerSecond: bigint;
  private readonly reserveBase: bigint;
  private readonly now: () => number;

  private state: StreamState = "active";
  private pauseReason: PauseReason | undefined;
  private accruedBase = 0n;
  private settledBase = 0n;
  private lastTickMs: number;

  constructor(input: OpenStreamInput) {
    this.id = input.id ?? `pst_${uuid().replace(/-/g, "").slice(0, 24)}`;
    this.payer = input.payer;
    this.payee = input.payee;
    this.network = input.network;
    this.rateBasePerSecond = toBaseUnits(money(input.ratePerSecondUsdc).amount);
    this.reserveBase = toBaseUnits(money(input.reserveUsdc).amount);
    this.now = input.now ?? Date.now;
    this.lastTickMs = this.now();
  }

  /** Accrue value up to the current clock. No-op unless active. */
  private advance(): void {
    if (this.state !== "active") {
      return;
    }
    const t = this.now();
    const elapsedMs = t - this.lastTickMs;
    this.lastTickMs = t;
    if (elapsedMs <= 0) {
      return;
    }
    let add = (BigInt(elapsedMs) * this.rateBasePerSecond) / 1000n;
    const headroom = this.reserveBase - this.accruedBase;
    if (add > headroom) {
      add = headroom;
    }
    if (add > 0n) {
      this.accruedBase += add;
    }
  }

  /** Pause the meter (manual). Excludes the paused interval from billing. */
  pause(reason: PauseReason = "manual"): void {
    if (this.state !== "active") {
      return;
    }
    this.advance();
    this.state = "paused";
    this.pauseReason = reason;
  }

  /** Resume a paused meter; the gap is not billed. */
  resume(): void {
    if (this.state !== "paused") {
      return;
    }
    this.lastTickMs = this.now();
    this.state = "active";
    this.pauseReason = undefined;
  }

  /**
   * Proof-of-flow signal. `false` pauses the meter immediately (delivery
   * dropped); `true` resumes a flow-paused meter. Manual pauses are untouched.
   */
  reportFlow(delivering: boolean): void {
    if (!delivering) {
      if (this.state === "active") {
        this.pause("flow");
      }
      return;
    }
    if (this.state === "paused" && this.pauseReason === "flow") {
      this.resume();
    }
  }

  /** Stop the meter permanently. Accrual freezes; the remainder is refundable. */
  stop(): void {
    if (this.state === "stopped") {
      return;
    }
    this.advance();
    this.state = "stopped";
    this.pauseReason = undefined;
  }

  /** Total value accrued so far (capped at the reserve). */
  accrued(): Money {
    this.advance();
    return money(fromBaseUnits(this.accruedBase));
  }

  /** Accrued but not yet settled. */
  due(): Money {
    this.advance();
    return money(fromBaseUnits(this.accruedBase - this.settledBase));
  }

  /** Reserved-but-unused remainder (refundable on stop). */
  refundable(): Money {
    this.advance();
    return money(fromBaseUnits(this.reserveBase - this.accruedBase));
  }

  /** Batch-settle the accrued-but-unsettled amount. Returns the settlement
   * (which may be zero if nothing is due). */
  async settle(sink?: StreamSettleSink): Promise<StreamSettlement> {
    this.advance();
    const dueBase = this.accruedBase - this.settledBase;
    this.settledBase = this.accruedBase;
    const settlement: StreamSettlement = {
      streamId: this.id,
      amount: money(fromBaseUnits(dueBase)),
      settledTotal: money(fromBaseUnits(this.settledBase)),
      at: this.timestamp(),
    };
    if (sink !== undefined && dueBase > 0n) {
      await sink(settlement);
    }
    return settlement;
  }

  /** Stop the stream, settle the tail, and report the refund owed to the payer. */
  async close(sink?: StreamSettleSink): Promise<{ finalSettlement: StreamSettlement; refund: Money }> {
    this.stop();
    const finalSettlement = await this.settle(sink);
    return { finalSettlement, refund: money(fromBaseUnits(this.reserveBase - this.accruedBase)) };
  }

  snapshot(): StreamSnapshot {
    this.advance();
    const dueBase = this.accruedBase - this.settledBase;
    return {
      id: this.id,
      state: this.state,
      ...(this.pauseReason !== undefined ? { pauseReason: this.pauseReason } : {}),
      ratePerSecondUsdc: fromBaseUnits(this.rateBasePerSecond),
      reserveUsdc: fromBaseUnits(this.reserveBase),
      accruedUsdc: fromBaseUnits(this.accruedBase),
      settledUsdc: fromBaseUnits(this.settledBase),
      dueUsdc: fromBaseUnits(dueBase),
      refundableUsdc: fromBaseUnits(this.reserveBase - this.accruedBase),
    };
  }

  private timestamp(): IsoTimestamp {
    return toIso(new Date(this.now()));
  }
}

/** Open a new {@link PaymentStream}. */
export function openStream(input: OpenStreamInput): PaymentStream {
  return new PaymentStream(input);
}
