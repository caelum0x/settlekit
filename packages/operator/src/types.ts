/**
 * Shared domain types for the SettleKit autonomous operator.
 *
 * All money is USDC in bigint base units (6 dp), matching OperatorVault's
 * uint256 accounting exactly. Every type is readonly: state transitions return
 * new values, never mutate.
 */

/** Vault buckets, in the same order as `OperatorVault.Bucket`. */
export const BUCKETS = ["OPERATING", "TAX", "YIELD", "REFUND"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Per-bucket USDC base-unit balances. */
export type BucketBalances = Readonly<Record<Bucket, bigint>>;

export const EMPTY_BUCKETS: BucketBalances = Object.freeze({
  OPERATING: 0n,
  TAX: 0n,
  YIELD: 0n,
  REFUND: 0n,
});

/** Index of a bucket in the on-chain enum. */
export function bucketIndex(bucket: Bucket): number {
  return BUCKETS.indexOf(bucket);
}

/** One committed operator spend, for UTC-day windowing. */
export interface SpendRecord {
  readonly amount: bigint;
  /** ISO-8601 timestamp the spend executed. */
  readonly at: string;
}

/** Snapshot of the vault as the policy and heuristic engine see it. */
export interface VaultSnapshot {
  readonly buckets: BucketBalances;
  readonly unallocated: bigint;
  readonly pendingReserved: bigint;
  readonly yieldDeployed: bigint;
  readonly yieldEnabled: boolean;
  readonly paused: boolean;
  readonly allowlist: readonly string[];
  /** Operator spends (paid or owner-approved) used for the UTC daily cap. */
  readonly spends: readonly SpendRecord[];
}

/** An accounts-payable bill tracked by the operator. */
export interface Bill {
  readonly id: string;
  readonly orgId: string;
  readonly payee: string;
  readonly amount: bigint;
  readonly dueAt: string;
  readonly description: string;
  readonly status: "open" | "paid" | "escalated" | "rejected";
  readonly createdAt: string;
}

/** Sum all bucket balances. */
export function sumBuckets(buckets: BucketBalances): bigint {
  return BUCKETS.reduce((acc, b) => acc + buckets[b], 0n);
}
