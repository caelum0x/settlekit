import { describe, expect, it } from "vitest";
import {
  formatUsdc,
  fromUsdcBaseUnits,
  jobAmountToMoney,
  parseUsdc,
  toUsdcBaseUnits,
} from "../src/amount.js";

describe("USDC amount conversion", () => {
  it("converts a whole-dollar decimal to 6-dp base units", () => {
    expect(toUsdcBaseUnits("100.00")).toBe(100_000_000n);
  });

  it("round-trips base units back to a normalized decimal string", () => {
    expect(fromUsdcBaseUnits(100_000_000n)).toBe("100");
  });

  it("handles sub-cent precision down to 6 dp", () => {
    expect(toUsdcBaseUnits("0.005")).toBe(5_000n);
    expect(fromUsdcBaseUnits(5_000n)).toBe("0.005");
  });

  it("agrees with the viem parseUnits/formatUnits equivalents", () => {
    for (const v of ["0", "1", "100.00", "0.005", "12.345678"]) {
      expect(parseUsdc(v)).toBe(toUsdcBaseUnits(v));
    }
    for (const b of [0n, 1n, 5_000n, 100_000_000n, 12_345_678n]) {
      // formatUsdc may keep trailing zeros; compare after re-parsing.
      expect(parseUsdc(formatUsdc(b))).toBe(b);
    }
  });

  it("rejects amounts with more than 6 decimal places", () => {
    expect(() => toUsdcBaseUnits("1.0000001")).toThrow(RangeError);
  });

  it("maps base units to a USDC Money value", () => {
    const m = jobAmountToMoney(100_000_000n);
    expect(m.amount).toBe("100");
    expect(m.currency).toBe("USDC");
  });
});
