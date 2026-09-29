import { describe, expect, it } from "vitest";
import { AllocationError, addBuckets, allocate, toVaultAmounts } from "../src/allocation.js";
import { sumBuckets } from "../src/types.js";
import { POLICY, U, buckets } from "./fixtures.js";

describe("allocate", () => {
  it("splits a round amount exactly", () => {
    const out = allocate(1_000n * U, POLICY);
    expect(out).toEqual({ TAX: 250n * U, YIELD: 150n * U, REFUND: 75n * U, OPERATING: 525n * U });
  });

  it("always sums to the gross, with remainder in OPERATING", () => {
    const odd = [1n, 3n, 7n, 999_999n, 1_234_567n, 10n ** 18n + 7n, 33_333_333n];
    for (const gross of odd) {
      const out = allocate(gross, POLICY);
      expect(sumBuckets(out)).toBe(gross);
      expect(Object.values(out).every((v) => v >= 0n)).toBe(true);
    }
  });

  it("floors tax, yield and refund", () => {
    const out = allocate(7n, { split: { OPERATING: 3_334, YIELD: 3_333, REFUND: 3_333 }, taxRateBps: 3_333 });
    expect(out.TAX).toBe(2n); // floor(7 * 0.3333)
    expect(out.YIELD).toBe(1n); // floor(5 * 0.3333)
    expect(out.REFUND).toBe(1n);
    expect(out.OPERATING).toBe(3n);
  });

  it("rejects non-positive gross and bad splits", () => {
    expect(() => allocate(0n, POLICY)).toThrow(AllocationError);
    expect(() => allocate(-5n, POLICY)).toThrow(AllocationError);
    expect(() => allocate(100n, { split: { OPERATING: 5_000, YIELD: 5_000, REFUND: 1 }, taxRateBps: 0 })).toThrow(/sum/);
    expect(() => allocate(100n, { split: POLICY.split, taxRateBps: 10_001 })).toThrow(/range/);
  });

  it("returns frozen results and vault-ordered tuples", () => {
    const out = allocate(100n * U, POLICY);
    expect(Object.isFrozen(out)).toBe(true);
    expect(toVaultAmounts(out)).toEqual([out.OPERATING, out.TAX, out.YIELD, out.REFUND]);
  });

  it("adds bucket maps without mutating inputs", () => {
    const a = buckets({ OPERATING: 1n, TAX: 2n });
    const b = buckets({ OPERATING: 3n, REFUND: 4n });
    expect(addBuckets(a, b)).toEqual({ OPERATING: 4n, TAX: 2n, YIELD: 0n, REFUND: 4n });
    expect(a.OPERATING).toBe(1n);
  });
});

describe("bucketIndex", () => {
  it("matches the OperatorVault.Bucket enum order", async () => {
    const { bucketIndex } = await import("../src/types.js");
    expect(["OPERATING", "TAX", "YIELD", "REFUND"].map((b) => bucketIndex(b as never))).toEqual([0, 1, 2, 3]);
  });
});
