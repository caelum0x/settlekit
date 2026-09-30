/**
 * Parse the dashboard's tax form (plain text fields) into tax settings.
 * Rates are typed as percentages ("DE=19, FR=20"); the API stores basis
 * points and validates again.
 */
import type { TaxSettings } from "./types";

function percentToBps(raw: string, what: string): number {
  const value = raw.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) throw new Error(`${what} must be a percentage like 19 or 7.5`);
  const bps = Math.round(Number(value) * 100);
  if (bps > 10_000) throw new Error(`${what} must be at most 100%`);
  return bps;
}

export function parseTaxForm(values: Record<string, string>): TaxSettings {
  const rates: Record<string, number> = {};
  for (const entry of (values.rates ?? "").split(/[\n;,]+/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [country, rate] = trimmed.split(/[=:]/).map((p) => p.trim());
    if (!country || !/^[A-Za-z]{2}$/.test(country) || rate === undefined) {
      throw new Error(`Write each rate as COUNTRY=percent, e.g. DE=19 (got "${trimmed}")`);
    }
    rates[country.toUpperCase()] = percentToBps(rate, `Rate for ${country.toUpperCase()}`);
  }
  const sellerCountry = (values.sellerCountry ?? "").trim().toUpperCase();
  if (sellerCountry && !/^[A-Z]{2}$/.test(sellerCountry)) throw new Error("Your country must be a two-letter code, e.g. DE");
  return {
    enabled: values.enabled === "yes",
    label: (values.label ?? "").trim() || "Tax",
    ...(sellerCountry ? { sellerCountry } : {}),
    ...((values.taxId ?? "").trim() ? { taxId: values.taxId!.trim() } : {}),
    ...((values.legalName ?? "").trim() ? { legalName: values.legalName!.trim() } : {}),
    defaultRateBps: (values.defaultRate ?? "").trim() ? percentToBps(values.defaultRate!, "Default rate") : 0,
    rates,
    reverseCharge: values.reverseCharge === "yes",
  };
}

/** Render current settings back into the form's text shape (summary line). */
export function describeTax(tax: TaxSettings | undefined): string {
  if (!tax?.enabled) return "Tax is off: checkout charges the list price.";
  const rates = Object.entries(tax.rates)
    .map(([c, bps]) => `${c} ${bps / 100}%`)
    .join(", ");
  return [
    `${tax.label} on: ${rates || "no country rates"}; other countries ${tax.defaultRateBps / 100}%.`,
    tax.taxId ? `Tax ID ${tax.taxId}${tax.sellerCountry ? ` (${tax.sellerCountry})` : ""}.` : "",
    tax.reverseCharge ? "EU reverse charge for business buyers with a VAT ID." : "",
  ]
    .filter(Boolean)
    .join(" ");
}
