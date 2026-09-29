/**
 * Treasury state for the operator console: vault bucket balances (read from
 * the vault — on-chain when a real OperatorVault is configured), today's
 * operator spend against the caps, and the pending escalation count.
 */
import type { VaultCaps } from "./executor.js";
import { BUCKETS, sumBuckets, type Bucket, type VaultSnapshot } from "./types.js";
import { formatUsdc } from "./usdc.js";

export interface OperatorState {
  readonly orgId: string;
  readonly buckets: Readonly<Record<Bucket, string>>;
  /** USDC held by the vault, excluding principal deployed to yield. */
  readonly total: string;
  readonly unallocated: string;
  readonly pendingReserved: string;
  readonly yieldDeployed: string;
  readonly yieldEnabled: boolean;
  readonly paused: boolean;
  readonly spentToday: string;
  readonly caps: Readonly<{ perTxCap: string; dailyCap: string; escalateAbove: string }>;
  /** Share of the daily cap already spent today, 0..1 (capped at 1). */
  readonly dailyCapUsed: number;
  readonly pendingEscalations: number;
  readonly asOf: string;
}

export interface StateInput {
  readonly orgId: string;
  readonly snapshot: VaultSnapshot;
  /** Caps as enforced (on-chain caps when a vault is configured). */
  readonly caps: VaultCaps;
  readonly pendingEscalations: number;
  readonly now: Date;
}

/** UTC day key (days since epoch), matching OperatorVault.currentDay(). */
export function utcDay(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

/** Operator spend recorded in the same UTC day as `now`. */
export function spentOn(snapshot: VaultSnapshot, now: Date): bigint {
  const today = utcDay(now);
  return snapshot.spends.filter((s) => utcDay(new Date(s.at)) === today).reduce((acc, s) => acc + s.amount, 0n);
}

/** Pure projection of a vault snapshot into the console's state view. */
export function buildOperatorState(input: StateInput): OperatorState {
  const { snapshot, caps } = input;
  const spent = spentOn(snapshot, input.now);
  const used = caps.dailyCap > 0n ? Number((spent * 10_000n) / caps.dailyCap) / 10_000 : 0;
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, formatUsdc(snapshot.buckets[b])])) as Record<Bucket, string>;
  return {
    orgId: input.orgId,
    buckets,
    // USDC held by the vault (buckets + reserved escalations + unallocated);
    // principal deployed to the yield adapter is reported separately.
    total: formatUsdc(sumBuckets(snapshot.buckets) + snapshot.pendingReserved + snapshot.unallocated),
    unallocated: formatUsdc(snapshot.unallocated),
    pendingReserved: formatUsdc(snapshot.pendingReserved),
    yieldDeployed: formatUsdc(snapshot.yieldDeployed),
    yieldEnabled: snapshot.yieldEnabled,
    paused: snapshot.paused,
    spentToday: formatUsdc(spent),
    caps: { perTxCap: formatUsdc(caps.perTxCap), dailyCap: formatUsdc(caps.dailyCap), escalateAbove: formatUsdc(caps.escalateAbove) },
    dailyCapUsed: Math.min(1, used),
    pendingEscalations: input.pendingEscalations,
    asOf: input.now.toISOString(),
  };
}
