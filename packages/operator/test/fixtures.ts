import type { OperatorPolicy } from "../src/policy.js";
import { EMPTY_BUCKETS, type BucketBalances, type SpendRecord, type VaultSnapshot } from "../src/types.js";

export const U = 1_000_000n; // 1 USDC in base units
export const PER_TX = 1_000n * U;
export const DAILY = 1_500n * U;
export const ESCALATE_ABOVE = 500n * U;
/** Same instant as the forge suite's T0 (1_760_000_000 s). */
export const T0 = new Date(1_760_000_000 * 1000);
export const DAY_MS = 86_400_000;

export const VENDOR = "0x00000000000000000000000000000000007e2d02";
export const STRANGER = "0x0000000000000000000000000000000000000bad";

export const POLICY: OperatorPolicy = {
  split: { OPERATING: 7_000, YIELD: 2_000, REFUND: 1_000 },
  taxRateBps: 2_500,
  perTxCap: PER_TX,
  dailyCap: DAILY,
  escalateAbove: ESCALATE_ABOVE,
  minFloat: 0n,
  yieldTarget: 0n,
  allowlist: [VENDOR],
  maxX402PerDay: 20,
};

export function buckets(partial: Partial<Record<keyof BucketBalances, bigint>>): BucketBalances {
  return { ...EMPTY_BUCKETS, ...partial };
}

export function snapshot(overrides: Partial<VaultSnapshot> = {}): VaultSnapshot {
  return {
    buckets: EMPTY_BUCKETS,
    unallocated: 0n,
    pendingReserved: 0n,
    yieldDeployed: 0n,
    yieldEnabled: false,
    paused: false,
    allowlist: [VENDOR],
    spends: [] as SpendRecord[],
    ...overrides,
  };
}

/** Start of the UTC day after `at`. */
export function nextUtcDay(at: Date): Date {
  return new Date((Math.floor(at.getTime() / DAY_MS) + 1) * DAY_MS);
}
