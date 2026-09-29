/**
 * Revenue allocation math in bigint base units.
 *
 * TAX takes `taxRateBps` of gross (floored). The net remainder is split across
 * YIELD and REFUND by their bps (floored) and OPERATING receives everything
 * left, so the four buckets always sum to exactly the gross amount — no dust
 * is created or lost, and the result is safe to pass to `OperatorVault.allocate`.
 */
import { BPS, type OperatorPolicy } from "./policy.js";
import { BUCKETS, type BucketBalances } from "./types.js";

const BPS_BIG = BigInt(BPS);

export class AllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationError";
  }
}

/** Split `gross` USDC base units into the four buckets per policy. */
export function allocate(gross: bigint, policy: Pick<OperatorPolicy, "split" | "taxRateBps">): BucketBalances {
  if (gross <= 0n) throw new AllocationError("gross must be positive");
  const { split, taxRateBps } = policy;
  if (split.OPERATING + split.YIELD + split.REFUND !== BPS) {
    throw new AllocationError("split must sum to 10000 bps");
  }
  if (taxRateBps < 0 || taxRateBps > BPS) throw new AllocationError("taxRateBps out of range");

  const tax = (gross * BigInt(taxRateBps)) / BPS_BIG;
  const net = gross - tax;
  const yieldPart = (net * BigInt(split.YIELD)) / BPS_BIG;
  const refund = (net * BigInt(split.REFUND)) / BPS_BIG;
  const operating = net - yieldPart - refund;
  return Object.freeze({ OPERATING: operating, TAX: tax, YIELD: yieldPart, REFUND: refund });
}

/** The `uint256[4]` argument for `OperatorVault.allocate`, in enum order. */
export function toVaultAmounts(amounts: BucketBalances): readonly [bigint, bigint, bigint, bigint] {
  return [amounts.OPERATING, amounts.TAX, amounts.YIELD, amounts.REFUND];
}

/** Add two bucket maps (new object). */
export function addBuckets(a: BucketBalances, b: BucketBalances): BucketBalances {
  const out = Object.fromEntries(BUCKETS.map((k) => [k, a[k] + b[k]])) as Record<keyof BucketBalances, bigint>;
  return Object.freeze(out);
}
