import { describe, expect, it } from "vitest";
import { isVatIdShape, normalizeTaxSettings, resolveCheckoutTax, type TaxSettings } from "../src/index.js";

const settings: TaxSettings = {
  enabled: true,
  label: "VAT",
  sellerCountry: "DE",
  taxId: "DE123456789",
  defaultRateBps: 0,
  rates: { DE: 1900, FR: 2000 },
  reverseCharge: true,
};

describe("checkout tax", () => {
  it("is off when the seller does not charge tax", () => {
    expect(resolveCheckoutTax(undefined)).toBeNull();
    expect(resolveCheckoutTax({ ...settings, enabled: false }, { country: "DE" })).toBeNull();
  });

  it("uses the buyer's country rate, the seller's country by default, else the default rate", () => {
    expect(resolveCheckoutTax(settings, { country: "fr" })).toMatchObject({ rateBps: 2000, jurisdiction: "FR", reverseCharge: false });
    expect(resolveCheckoutTax(settings, {})).toMatchObject({ rateBps: 1900, jurisdiction: "DE", country: "DE" });
    expect(resolveCheckoutTax(settings, { country: "US" })).toMatchObject({ rateBps: 0, jurisdiction: "US" });
    expect(resolveCheckoutTax(settings, { country: "not a country" })).toMatchObject({ jurisdiction: "DE" });
  });

  it("zero-rates EU cross-border B2B with a VAT ID of the right shape", () => {
    expect(resolveCheckoutTax(settings, { country: "FR", vatId: "fr 12 345678901" })).toMatchObject({
      rateBps: 0,
      reverseCharge: true,
      vatId: "FR12345678901",
    });
    // Same country: domestic VAT still applies.
    expect(resolveCheckoutTax(settings, { country: "DE", vatId: "DE987654321" })).toMatchObject({ rateBps: 1900, reverseCharge: false });
    // Wrong prefix: no reverse charge.
    expect(resolveCheckoutTax(settings, { country: "FR", vatId: "DE987654321" })).toMatchObject({ rateBps: 2000, reverseCharge: false });
    // Disabled by the seller.
    expect(resolveCheckoutTax({ ...settings, reverseCharge: false }, { country: "FR", vatId: "FR12345678901" })).toMatchObject({ rateBps: 2000 });
    expect(isVatIdShape("EL123456789", "GR")).toBe(true);
  });

  it("validates settings from the dashboard", () => {
    expect(normalizeTaxSettings({ ...settings, sellerCountry: "de", rates: { fr: 2000 }, label: " " })).toMatchObject({
      sellerCountry: "DE",
      rates: { FR: 2000 },
      label: "Tax",
    });
    expect(() => normalizeTaxSettings({ ...settings, rates: { FRA: 2000 } })).toThrow(/country code/);
    expect(() => normalizeTaxSettings({ ...settings, defaultRateBps: 12.5 })).toThrow(/basis points/);
    expect(() => normalizeTaxSettings({ ...settings, sellerCountry: "Germany" })).toThrow(/two-letter/);
  });
});
