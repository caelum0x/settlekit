/**
 * Conserved integer allocation.
 *
 * Splitting a fixed budget across weighted recipients with floating-point math
 * leaks fractions of a cent and the legs no longer sum to the budget. We instead
 * use the largest-remainder (Hamilton) method over integer base units, the same
 * exact-conservation discipline the citation-toll royalty splitter uses: every
 * base unit of the budget is assigned to exactly one recipient, so the legs sum
 * to the budget precisely — no money created, none lost.
 */

const WEIGHT_SCALE = 1_000_000_000n; // weights are floats; scale to integers for exact math.

/**
 * Allocate `totalBase` base units across `weights`, returning an array of the
 * same length whose entries are non-negative and sum exactly to `totalBase`.
 *
 * Negative or non-finite weights are treated as zero. When every weight is zero
 * the budget is spread as evenly as integer division allows (remainder to the
 * lowest indices), so a valid plan is always produced.
 */
export function conservedAllocation(weights: readonly number[], totalBase: bigint): bigint[] {
  const n = weights.length;
  const result = new Array<bigint>(n).fill(0n);
  if (n === 0 || totalBase <= 0n) return result;

  const scaled = weights.map((w) => (Number.isFinite(w) && w > 0 ? BigInt(Math.round(w * 1e9)) : 0n));
  let totalWeight = scaled.reduce((sum, w) => sum + w, 0n);

  // Degenerate case: no positive weight — fall back to an even split.
  if (totalWeight === 0n) {
    for (let i = 0; i < n; i += 1) scaled[i] = WEIGHT_SCALE;
    totalWeight = WEIGHT_SCALE * BigInt(n);
  }

  // Floor each share, tracking the integer-division remainder for largest-remainder.
  const remainders: Array<{ index: number; remainder: bigint }> = [];
  let assigned = 0n;
  for (let i = 0; i < n; i += 1) {
    const numerator = totalBase * (scaled[i] as bigint);
    const floor = numerator / totalWeight;
    result[i] = floor;
    assigned += floor;
    remainders.push({ index: i, remainder: numerator % totalWeight });
  }

  // Distribute the leftover base units to the largest remainders (ties: lowest index).
  let leftover = totalBase - assigned;
  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (let k = 0; leftover > 0n && k < remainders.length; k += 1) {
    const slot = remainders[k] as { index: number; remainder: bigint };
    result[slot.index] = (result[slot.index] as bigint) + 1n;
    leftover -= 1n;
  }

  return result;
}
