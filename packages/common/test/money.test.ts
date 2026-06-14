import { describe, it, expect } from "vitest";
import {
  money,
  toBaseUnits,
  fromBaseUnits,
  addMoney,
  subtractMoney,
  multiplyMoney,
  compareMoney,
  normalizeAmount,
  isZero,
} from "../src/money.js";

describe("money base unit conversion", () => {
  it("converts whole and fractional amounts to 6-decimal base units", () => {
    expect(toBaseUnits("1")).toBe(1_000_000n);
    expect(toBaseUnits("25.5")).toBe(25_500_000n);
    expect(toBaseUnits("0.005")).toBe(5_000n);
    expect(toBaseUnits("0.000001")).toBe(1n);
  });

  it("round-trips through fromBaseUnits", () => {
    expect(fromBaseUnits(25_500_000n)).toBe("25.5");
    expect(fromBaseUnits(5_000n)).toBe("0.005");
    expect(fromBaseUnits(1n)).toBe("0.000001");
    expect(fromBaseUnits(0n)).toBe("0");
  });

  it("rejects amounts with more than 6 decimals", () => {
    expect(() => money("0.0000001")).toThrow(/decimal places/);
  });

  it("rejects non-numeric amounts", () => {
    expect(() => money("abc")).toThrow();
    expect(() => money("1.2.3")).toThrow();
  });
});

describe("money arithmetic", () => {
  it("adds and subtracts without floating point drift", () => {
    expect(addMoney(money("0.1"), money("0.2")).amount).toBe("0.3");
    expect(subtractMoney(money("1"), money("0.999999")).amount).toBe("0.000001");
  });

  it("multiplies by integer quantity", () => {
    expect(multiplyMoney(money("25"), 3).amount).toBe("75");
    expect(() => multiplyMoney(money("1"), 1.5)).toThrow();
  });

  it("compares amounts", () => {
    expect(compareMoney(money("1"), money("2"))).toBe(-1);
    expect(compareMoney(money("2"), money("2"))).toBe(0);
    expect(compareMoney(money("3"), money("2"))).toBe(1);
  });

  it("normalizes trailing zeros", () => {
    expect(normalizeAmount("25.500000")).toBe("25.5");
    expect(normalizeAmount("0.0")).toBe("0");
    expect(isZero(money("0.000000"))).toBe(true);
  });

  it("throws on currency mismatch is impossible (only USDC) but guards same-currency", () => {
    expect(addMoney(money("1"), money("1")).currency).toBe("USDC");
  });
});
