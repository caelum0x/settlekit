import { describe, expect, it } from "vitest";
import { effectiveUnitAmount, fiatToUsdc, formatRate, isFiatCurrency } from "../src/index.js";

describe("fiat to USDC", () => {
  it("converts with exact math, half-up to the cent", () => {
    expect(fiatToUsdc("29", "1.0834")).toBe("31.42"); // 31.4186
    expect(fiatToUsdc("10", "1.2345")).toBe("12.35"); // 12.345 -> half up
    expect(fiatToUsdc("1000", "0.0067123456")).toBe("6.71"); // JPY
    expect(fiatToUsdc("0", "1.1")).toBe("0");
  });

  it("rejects bad rates and amounts", () => {
    expect(() => fiatToUsdc("10", "0")).toThrow(/positive/);
    expect(() => fiatToUsdc("10", "-1")).toThrow(/invalid/);
    expect(() => fiatToUsdc("10", "1e3")).toThrow(/invalid/);
    expect(() => fiatToUsdc("-1", "1.1")).toThrow(/negative/);
    expect(formatRate(1.08340000001)).toBe("1.0834");
    expect(() => formatRate(Number.NaN)).toThrow();
  });

  it("picks the converted amount only under a matching quote", () => {
    const price = { amount: "31", displayCurrency: "EUR", displayAmount: "29" };
    expect(effectiveUnitAmount(price, { currency: "EUR", rate: "1.1" })).toBe("31.9");
    expect(effectiveUnitAmount(price, { currency: "GBP", rate: "1.3" })).toBe("31");
    expect(effectiveUnitAmount(price, undefined)).toBe("31");
    expect(effectiveUnitAmount({ amount: "5" }, { currency: "EUR", rate: "1.1" })).toBe("5");
    expect(isFiatCurrency("EUR")).toBe(true);
    expect(isFiatCurrency("XYZ")).toBe(false);
  });
});
