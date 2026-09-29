/**
 * Per-event state of one Claude run: the tool trace, the proposals Claude has
 * made that passed policy, and a projected vault snapshot that reflects those
 * accepted proposals, so two payouts in one run cannot jointly overdraw a
 * bucket or the daily cap. Every mutation replaces a frozen value.
 */
import type { Proposal } from "./actions.js";
import type { EngineContext } from "./context.js";
import type { ToolCallRecord } from "./decision-log.js";
import type { OperatorEvent } from "./events.js";
import type { Bucket, VaultSnapshot } from "./types.js";

export const MAX_PROPOSALS_PER_EVENT = 6;

export class ToolSession {
  private calls: readonly ToolCallRecord[] = [];
  private accepted: readonly Proposal[] = [];
  private projected: VaultSnapshot;
  private x402Count: number;

  constructor(
    readonly event: OperatorEvent,
    readonly ctx: EngineContext,
  ) {
    this.projected = ctx.vault;
    this.x402Count = ctx.x402PurchasesToday;
  }

  get toolCalls(): readonly ToolCallRecord[] {
    return this.calls;
  }

  get proposals(): readonly Proposal[] {
    return this.accepted;
  }

  get vault(): VaultSnapshot {
    return this.projected;
  }

  get x402PurchasesToday(): number {
    return this.x402Count;
  }

  get full(): boolean {
    return this.accepted.length >= MAX_PROPOSALS_PER_EVENT;
  }

  record(name: string, input: unknown, output: unknown): void {
    this.calls = [...this.calls, Object.freeze({ name, input, output })];
  }

  accept(p: Proposal): void {
    this.accepted = [...this.accepted, p];
  }

  /** Reflect an accepted immediate spend in the projected snapshot. */
  reserveSpend(bucket: Bucket, amount: bigint): void {
    const v = this.projected;
    this.projected = Object.freeze({
      ...v,
      buckets: Object.freeze({ ...v.buckets, [bucket]: v.buckets[bucket] - amount }),
      spends: [...v.spends, { amount, at: this.ctx.now.toISOString() }],
    });
  }

  /** Reflect an accepted vault escalation (amount moves to pendingReserved). */
  reserveEscalation(bucket: Bucket, amount: bigint): void {
    const v = this.projected;
    this.projected = Object.freeze({
      ...v,
      buckets: Object.freeze({ ...v.buckets, [bucket]: v.buckets[bucket] - amount }),
      pendingReserved: v.pendingReserved + amount,
    });
  }

  reserveAllocation(amounts: VaultSnapshot["buckets"], total: bigint): void {
    const v = this.projected;
    const buckets = Object.freeze({
      OPERATING: v.buckets.OPERATING + amounts.OPERATING,
      TAX: v.buckets.TAX + amounts.TAX,
      YIELD: v.buckets.YIELD + amounts.YIELD,
      REFUND: v.buckets.REFUND + amounts.REFUND,
    });
    this.projected = Object.freeze({ ...v, buckets, unallocated: v.unallocated - total });
  }

  reserveSweep(amount: bigint): void {
    const v = this.projected;
    this.projected = Object.freeze({
      ...v,
      buckets: Object.freeze({ ...v.buckets, YIELD: v.buckets.YIELD - amount }),
      yieldDeployed: v.yieldDeployed + amount,
    });
  }

  countX402Purchase(): void {
    this.x402Count += 1;
  }
}
