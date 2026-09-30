import { describe, expect, it } from "vitest";
import { CHECKOUT_MESSAGES, checkoutTranslator, format, pickCheckoutLocale } from "../src/index.js";

describe("checkout localization", () => {
  it("picks es or en from Accept-Language, honoring an explicit choice", () => {
    expect(pickCheckoutLocale("es-ES,es;q=0.9,en;q=0.8")).toBe("es");
    expect(pickCheckoutLocale("de-DE,de;q=0.9,es;q=0.5")).toBe("es");
    expect(pickCheckoutLocale("fr-FR,fr;q=0.9")).toBe("en");
    expect(pickCheckoutLocale("es;q=0, en")).toBe("en");
    expect(pickCheckoutLocale(null)).toBe("en");
    expect(pickCheckoutLocale("es", "en")).toBe("en");
    expect(pickCheckoutLocale("en", "ES")).toBe("es");
    expect(pickCheckoutLocale("en", "tr")).toBe("en");
  });

  it("translates with placeholders and ships Spanish for every key", () => {
    const es = checkoutTranslator("es");
    expect(es("order.soldBy", { merchant: "Acme" })).toBe("Vendido por Acme");
    expect(checkoutTranslator("en")("invoice.pay", { amount: "10", currency: "USDC" })).toBe("Pay 10 USDC");
    expect(format("{a} {b}", { a: 1 })).toBe("1 {b}");
    for (const [key, entry] of Object.entries(CHECKOUT_MESSAGES)) {
      expect((entry as Record<string, string>).es, key).toBeTruthy();
    }
  });
});
