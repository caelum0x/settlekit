/**
 * LocalExecutor — an in-memory simulation of OperatorVault.
 *
 * Implements the vault's rules independently of `policy.ts` (same check order,
 * same custom error names) so parity tests can compare the two. State is held
 * as one frozen value that every operation replaces; nothing is mutated in
 * place. `anchors` mirrors the on-chain `DecisionAnchored` event stream.
 */
import { createHash } from "node:crypto";
import { addBuckets } from "./allocation.js";
import { ESCALATION_TTL_MS } from "./escalation.js";
import {
  VaultError,
  type OperatorExecutor,
  type OwnerExecutor,
  type PayResult,
  type TxResult,
  type VaultCaps,
} from "./executor.js";
import { BUCKETS, EMPTY_BUCKETS, sumBuckets, type Bucket, type BucketBalances, type SpendRecord, type VaultSnapshot } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ZERO_HASH = `0x${"0".repeat(64)}`;

export type LocalEscalationStatus = "Pending" | "Approved" | "Rejected" | "Expired";

export interface LocalEscalation {
  readonly id: number;
  readonly decisionHash: string;
  readonly bucket: Bucket;
  readonly to: string;
  readonly amount: bigint;
  readonly createdAt: number;
  readonly status: LocalEscalationStatus;
}

export interface Anchor {
  readonly decisionHash: string;
  readonly action: string;
}

interface LocalState {
  readonly held: bigint;
  readonly buckets: BucketBalances;
  readonly pendingReserved: bigint;
  readonly yieldDeployed: bigint;
  readonly yieldEnabled: boolean;
  readonly paused: boolean;
  readonly caps: VaultCaps;
  readonly allowlist: readonly string[];
  readonly spends: readonly SpendRecord[];
  readonly escalations: Readonly<Record<number, LocalEscalation>>;
  readonly nextId: number;
  readonly anchors: readonly Anchor[];
  readonly txCount: number;
}

export interface LocalExecutorOptions {
  readonly caps: VaultCaps;
  readonly allowlist?: readonly string[];
  readonly yieldEnabled?: boolean;
  readonly now?: () => Date;
}

const norm = (address: string): string => address.toLowerCase();

export class LocalExecutor implements OperatorExecutor, OwnerExecutor {
  private state: LocalState;
  private readonly now: () => Date;

  constructor(options: LocalExecutorOptions) {
    validateCaps(options.caps);
    this.now = options.now ?? (() => new Date());
    this.state = Object.freeze({
      held: 0n,
      buckets: EMPTY_BUCKETS,
      pendingReserved: 0n,
      yieldDeployed: 0n,
      yieldEnabled: options.yieldEnabled ?? false,
      paused: false,
      caps: options.caps,
      allowlist: (options.allowlist ?? []).map(norm),
      spends: [],
      escalations: {},
      nextId: 1,
      anchors: [],
      txCount: 0,
    });
  }

  // ------------------------------------------------------------- inspection

  get anchors(): readonly Anchor[] {
    return this.state.anchors;
  }

  escalation(id: number): LocalEscalation | undefined {
    return this.state.escalations[id];
  }

  spentToday(): bigint {
    const day = dayIndex(this.now());
    return this.state.spends.reduce((acc, s) => (dayIndex(new Date(s.at)) === day ? acc + s.amount : acc), 0n);
  }

  async snapshot(): Promise<VaultSnapshot> {
    const s = this.state;
    return Object.freeze({
      buckets: s.buckets,
      unallocated: this.unallocated(),
      pendingReserved: s.pendingReserved,
      yieldDeployed: s.yieldDeployed,
      yieldEnabled: s.yieldEnabled,
      paused: s.paused,
      allowlist: s.allowlist,
      spends: s.spends,
    });
  }

  /** Simulate a USDC inflow (a customer payment) landing in the vault. */
  deposit(amount: bigint): void {
    if (amount <= 0n) throw new VaultError("ZeroAmount");
    this.state = Object.freeze({ ...this.state, held: this.state.held + amount });
  }

  private unallocated(): bigint {
    const accounted = sumBuckets(this.state.buckets) + this.state.pendingReserved;
    return this.state.held > accounted ? this.state.held - accounted : 0n;
  }

  // --------------------------------------------------------------- operator

  async allocate(decisionHash: string, amounts: BucketBalances): Promise<TxResult> {
    this.requireNotPaused();
    const total = sumBuckets(amounts);
    if (BUCKETS.some((b) => amounts[b] < 0n)) throw new VaultError("OverAllocation");
    if (total === 0n) throw new VaultError("ZeroAmount");
    if (total > this.unallocated()) throw new VaultError("OverAllocation");
    return this.commit({ buckets: addBuckets(this.state.buckets, amounts) }, decisionHash, "ALLOCATE");
  }

  async pay(decisionHash: string, bucket: Bucket, to: string, amount: bigint): Promise<PayResult> {
    this.requireNotPaused();
    const { caps, buckets } = this.state;
    if (bucket === "TAX") throw new VaultError("TaxLocked");
    if (amount <= 0n) throw new VaultError("ZeroAmount");
    if (!this.state.allowlist.includes(norm(to))) throw new VaultError("NotAllowlisted");
    if (amount > caps.perTxCap) throw new VaultError("PerTxCapExceeded");
    if (amount > buckets[bucket]) throw new VaultError("InsufficientBucket");

    if (amount > caps.escalateAbove) {
      const id = this.state.nextId;
      const escalation: LocalEscalation = Object.freeze({
        id, decisionHash, bucket, to: norm(to), amount, createdAt: this.now().getTime(), status: "Pending",
      });
      const tx = this.commit(
        {
          buckets: withBucket(buckets, bucket, buckets[bucket] - amount),
          pendingReserved: this.state.pendingReserved + amount,
          escalations: { ...this.state.escalations, [id]: escalation },
          nextId: id + 1,
        },
        decisionHash,
        "ESCALATE",
      );
      return { ...tx, status: "escalated", escalationId: id };
    }

    if (this.spentToday() + amount > caps.dailyCap) throw new VaultError("DailyCapExceeded");
    const tx = this.commit(
      {
        buckets: withBucket(buckets, bucket, buckets[bucket] - amount),
        held: this.state.held - amount,
        spends: [...this.state.spends, { amount, at: this.now().toISOString() }],
      },
      decisionHash,
      "PAY",
    );
    return { ...tx, status: "paid" };
  }

  async sweepToYield(decisionHash: string, amount: bigint): Promise<TxResult> {
    this.requireNotPaused();
    if (!this.state.yieldEnabled) throw new VaultError("YieldDisabled");
    if (amount <= 0n) throw new VaultError("ZeroAmount");
    const { buckets } = this.state;
    if (amount > buckets.YIELD) throw new VaultError("InsufficientBucket");
    return this.commit(
      {
        buckets: withBucket(buckets, "YIELD", buckets.YIELD - amount),
        held: this.state.held - amount,
        yieldDeployed: this.state.yieldDeployed + amount,
      },
      decisionHash,
      "SWEEP_TO_YIELD",
    );
  }

  async redeemFromYield(decisionHash: string, amount: bigint): Promise<TxResult> {
    this.requireNotPaused();
    if (!this.state.yieldEnabled) throw new VaultError("YieldDisabled");
    if (amount <= 0n) throw new VaultError("ZeroAmount");
    if (amount > this.state.yieldDeployed) throw new VaultError("InsufficientYield");
    const { buckets } = this.state;
    return this.commit(
      {
        buckets: withBucket(buckets, "YIELD", buckets.YIELD + amount),
        held: this.state.held + amount,
        yieldDeployed: this.state.yieldDeployed - amount,
      },
      decisionHash,
      "REDEEM_FROM_YIELD",
    );
  }

  // ------------------------------------------------------------------ owner

  async approve(escalationId: number): Promise<TxResult> {
    this.requireNotPaused();
    const e = this.requirePending(escalationId);
    if (this.now().getTime() > e.createdAt + ESCALATION_TTL_MS) throw new VaultError("EscalationExpired");
    if (!this.state.allowlist.includes(e.to)) throw new VaultError("NotAllowlisted");
    return this.commit(
      {
        pendingReserved: this.state.pendingReserved - e.amount,
        held: this.state.held - e.amount,
        spends: [...this.state.spends, { amount: e.amount, at: this.now().toISOString() }],
        escalations: { ...this.state.escalations, [e.id]: { ...e, status: "Approved" } },
      },
      e.decisionHash,
      "APPROVE",
    );
  }

  async reject(escalationId: number): Promise<TxResult> {
    return this.release(this.requirePending(escalationId), "Rejected", "REJECT");
  }

  async expire(escalationId: number): Promise<TxResult> {
    const e = this.requirePending(escalationId);
    if (this.now().getTime() <= e.createdAt + ESCALATION_TTL_MS) throw new VaultError("EscalationNotExpired");
    return this.release(e, "Expired", "EXPIRE");
  }

  async setCaps(decisionHash: string, caps: VaultCaps): Promise<TxResult> {
    validateCaps(caps);
    return this.commit({ caps }, decisionHash, "SET_CAPS");
  }

  async setAllowlist(decisionHash: string, payee: string, allowed: boolean): Promise<TxResult> {
    const without = this.state.allowlist.filter((a) => a !== norm(payee));
    return this.commit({ allowlist: allowed ? [...without, norm(payee)] : without }, decisionHash, "SET_ALLOWLIST");
  }

  async setYieldEnabled(decisionHash: string, enabled: boolean): Promise<TxResult> {
    if (!enabled && this.state.yieldDeployed !== 0n) throw new VaultError("InsufficientYield");
    return this.commit({ yieldEnabled: enabled }, decisionHash, "SET_YIELD_ADAPTER");
  }

  async pause(): Promise<TxResult> {
    return this.commit({ paused: true }, ZERO_HASH, "PAUSE");
  }

  async unpause(): Promise<TxResult> {
    return this.commit({ paused: false }, ZERO_HASH, "UNPAUSE");
  }

  // --------------------------------------------------------------- internal

  private release(e: LocalEscalation, status: LocalEscalationStatus, action: string): TxResult {
    return this.commit(
      {
        pendingReserved: this.state.pendingReserved - e.amount,
        buckets: withBucket(this.state.buckets, e.bucket, this.state.buckets[e.bucket] + e.amount),
        escalations: { ...this.state.escalations, [e.id]: { ...e, status } },
      },
      e.decisionHash,
      action,
    );
  }

  private requirePending(id: number): LocalEscalation {
    const e = this.state.escalations[id];
    if (!e || e.status !== "Pending") throw new VaultError("NotPending");
    return e;
  }

  private requireNotPaused(): void {
    if (this.state.paused) throw new VaultError("IsPaused");
  }

  private commit(patch: Partial<LocalState>, decisionHash: string, action: string): TxResult {
    const txCount = this.state.txCount + 1;
    const txHash = `0x${createHash("sha256").update(`${txCount}:${action}:${decisionHash}`).digest("hex")}`;
    this.state = Object.freeze({
      ...this.state,
      ...patch,
      anchors: [...this.state.anchors, { decisionHash, action }],
      txCount,
    });
    return { txHash };
  }
}

function dayIndex(at: Date): number {
  return Math.floor(at.getTime() / DAY_MS);
}

function withBucket(buckets: BucketBalances, bucket: Bucket, value: bigint): BucketBalances {
  return Object.freeze({ ...buckets, [bucket]: value });
}

function validateCaps(caps: VaultCaps): void {
  if (caps.perTxCap <= 0n || caps.dailyCap < caps.perTxCap || caps.escalateAbove > caps.perTxCap) {
    throw new VaultError("InvalidCaps");
  }
}
