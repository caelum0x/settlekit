import { describe, expect, it } from "vitest";
import { describeTax, parseTaxForm } from "../lib/tax-form";

describe("dashboard tax form", () => {
  it("parses percentages into basis points", () => {
    expect(
      parseTaxForm({
        enabled: "yes",
        label: "VAT",
        sellerCountry: "de",
        taxId: " DE123456789 ",
        rates: "de=19, FR:20\nit=22",
        defaultRate: "7.5",
        reverseCharge: "yes",
      }),
    ).toEqual({
      enabled: true,
      label: "VAT",
      sellerCountry: "DE",
      taxId: "DE123456789",
      defaultRateBps: 750,
      rates: { DE: 1900, FR: 2000, IT: 2200 },
      reverseCharge: true,
    });
  });

  it("rejects malformed rates and countries", () => {
    expect(() => parseTaxForm({ rates: "Germany=19" })).toThrow(/COUNTRY=percent/);
    expect(() => parseTaxForm({ rates: "DE=abc" })).toThrow(/percentage/);
    expect(() => parseTaxForm({ rates: "DE=150" })).toThrow(/at most 100/);
    expect(() => parseTaxForm({ sellerCountry: "Germany" })).toThrow(/two-letter/);
  });

  it("summarizes the current settings", () => {
    expect(describeTax(undefined)).toMatch(/off/);
    expect(describeTax({ enabled: true, label: "VAT", defaultRateBps: 0, rates: { DE: 1900 }, reverseCharge: true, taxId: "DE1", sellerCountry: "DE" })).toBe(
      "VAT on: DE 19%; other countries 0%. Tax ID DE1 (DE). EU reverse charge for business buyers with a VAT ID.",
    );
  });
});
