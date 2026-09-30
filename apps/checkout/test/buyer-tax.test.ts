import { describe, expect, it } from "vitest";
import { withSessionTax, type TaxSettings } from "@settlekit/persistence";

import { applyBuyerTax } from "../lib/buyer-tax";
import { CheckoutError } from "../lib/errors";
import { SESSION_CREATED, harness, openSession, type Harness } from "./harness";

const AT = new Date(SESSION_CREATED.getTime() + 60_000);
const TAX: TaxSettings = {
  enabled: true,
  label: "VAT",
  sellerCountry: "DE",
  defaultRateBps: 0,
  rates: { DE: 1900, FR: 2000 },
  reverseCharge: true,
};

function taxed(settings: TaxSettings | undefined): Harness {
  const base = harness();
  return { ...base, deps: { ...base.deps, backend: { ...base.deps.backend, taxSettings: async () => settings } } };
}

async function message(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CheckoutError);
  return (error as CheckoutError).message;
}

describe("buyer billing country and VAT ID", () => {
  it("re-rates the amount due from the net price", async () => {
    const h = taxed(TAX);
    const opened = await openSession(h, "base");
    // The API opened it at the seller's default rate (DE 19%).
    const session = await h.checkouts.save(withSessionTax(opened, TAX));
    expect(session.amount.amount).toBe("29.75");

    const fr = await applyBuyerTax(session.id, { country: "fr" }, h.deps, AT);
    expect(fr.amount.amount).toBe("30");
    expect(fr.tax).toMatchObject({ country: "FR", rateBps: 2000 });

    const b2b = await applyBuyerTax(session.id, { country: "FR", vatId: "FR 12345678901" }, h.deps, AT);
    expect(b2b.amount.amount).toBe("25");
    expect(b2b.tax).toMatchObject({ reverseCharge: true, vatId: "FR12345678901" });
  });

  it("refuses bad input, untaxed sellers and invoices", async () => {
    const h = taxed(TAX);
    const session = await openSession(h, "base");
    expect(await message(applyBuyerTax(session.id, { country: "France" }, h.deps, AT))).toMatch(/billing country/);
    expect(await message(applyBuyerTax(session.id, { country: "FR", vatId: "<b>" }, h.deps, AT))).toMatch(/VAT ID/);
    const invoice = await openSession(h, "base", { invoiceId: "inv_1" });
    expect(await message(applyBuyerTax(invoice.id, { country: "FR" }, h.deps, AT))).toMatch(/invoices/);

    const off = taxed(undefined);
    const plain = await openSession(off, "base");
    expect(await message(applyBuyerTax(plain.id, { country: "FR" }, off.deps, AT))).toMatch(/does not charge tax/);
  });
});
