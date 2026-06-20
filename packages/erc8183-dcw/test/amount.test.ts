import { describe, expect, it } from "vitest";
import { jobAmountToMoney, toUsdcBaseUnitsString } from "../src/amount.js";

describe("toUsdcBaseUnitsString", () => {
  it("converts a whole-dollar decimal to a 6-dp base-unit string", () => {
    expect(toUsdcBaseUnitsString("100.00")).toBe("100000000");
  });

  it("converts sub-cent precision down to 6 dp", () => {
    expect(toUsdcBaseUnitsString("0.005")).toBe("5000");
  });

  it("converts a bare integer dollar amount", () => {
    expect(toUsdcBaseUnitsString("1")).toBe("1000000");
  });

  it("converts zero to '0'", () => {
    expect(toUsdcBaseUnitsString("0")).toBe("0");
  });

  it("rejects amounts with more than 6 decimal places", () => {
    expect(() => toUsdcBaseUnitsString("1.0000001")).toThrow(RangeError);
  });
});

describe("jobAmountToMoney", () => {
  it("maps a base-unit string to a normalized USDC Money value", () => {
    const m = jobAmountToMoney("100000000");
    expect(m.amount).toBe("100");
    expect(m.currency).toBe("USDC");
  });

  it("round-trips through toUsdcBaseUnitsString", () => {
    const m = jobAmountToMoney(toUsdcBaseUnitsString("12.345678"));
    expect(m.amount).toBe("12.345678");
  });

  it("maps sub-cent base units", () => {
    expect(jobAmountToMoney("5000").amount).toBe("0.005");
  });
});
