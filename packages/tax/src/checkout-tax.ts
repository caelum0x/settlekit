/**
 * Checkout tax: which rate applies to a buyer, from the seller's settings.
 *
 * Tax is exclusive (added on top of the net price). The buyer's billing
 * country picks the rate (a per-country table, else the default rate). EU
 * B2B reverse charge: when the seller enables it, both parties are in the
 * EU in different countries and the buyer gives a VAT ID of the right shape,
 * the rate is 0 and the receipt says "Reverse charge". VAT IDs are checked
 * for shape only; online validation against the EU service is not done here.
 */

/** Seller tax configuration (stored on the organization settings). */
export interface TaxSettings {
  enabled: boolean;
  /** Tax name shown to buyers, e.g. "VAT", "GST", "Sales tax". */
  label: string;
  /** Seller's ISO 3166-1 alpha-2 country. */
  sellerCountry?: string;
  /** Seller's tax registration number (printed on receipts). */
  taxId?: string;
  /** Seller's legal name for tax documents (defaults to the org name). */
  legalName?: string;
  addressLines?: string[];
  /** Rate when the buyer's country has no entry, in basis points. */
  defaultRateBps: number;
  /** Per-country rates in basis points, keyed by alpha-2 code. */
  rates: Record<string, number>;
  /** Zero-rate EU cross-border B2B sales with a VAT ID. */
  reverseCharge: boolean;
}

/** EU member states (VAT prefixes; Greece uses EL). */
export const EU_COUNTRIES: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
  "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
];

const COUNTRY_RE = /^[A-Z]{2}$/;

export function normalizeCountry(value: string | undefined | null): string | undefined {
  const code = value?.trim().toUpperCase();
  return code && COUNTRY_RE.test(code) ? code : undefined;
}

export function isEuCountry(country: string | undefined): boolean {
  return country !== undefined && EU_COUNTRIES.includes(country);
}

/** Uppercase and strip spaces, dots and dashes from a VAT ID. */
export function normalizeVatId(value: string | undefined | null): string | undefined {
  const id = value?.replace(/[\s.-]/g, "").toUpperCase();
  return id && id.length > 0 ? id : undefined;
}

/** Whether a VAT ID has an EU shape for `country` (prefix + 2-12 chars). */
export function isVatIdShape(vatId: string | undefined, country: string | undefined): boolean {
  if (!vatId || !country) return false;
  const prefix = country === "GR" ? "EL" : country;
  return new RegExp(`^${prefix}[A-Z0-9+*]{2,12}$`).test(vatId);
}

export interface BuyerTaxInput {
  country?: string;
  vatId?: string;
}

/** The rate that applies to one buyer. */
export interface CheckoutTaxResult {
  rateBps: number;
  /** Country the rate belongs to (buyer country, else seller country, else "default"). */
  jurisdiction: string;
  label: string;
  reverseCharge: boolean;
  country?: string;
  vatId?: string;
}

/** Validate + normalize settings coming from the dashboard. Throws on bad input. */
export function normalizeTaxSettings(input: TaxSettings): TaxSettings {
  const bps = (n: number, what: string): number => {
    if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new Error(`${what} must be an integer in [0, 10000] basis points`);
    return n;
  };
  const rates: Record<string, number> = {};
  for (const [country, rate] of Object.entries(input.rates ?? {})) {
    const code = normalizeCountry(country);
    if (!code) throw new Error(`invalid country code in tax rates: ${country}`);
    rates[code] = bps(rate, `tax rate for ${code}`);
  }
  const sellerCountry = normalizeCountry(input.sellerCountry);
  if (input.sellerCountry && !sellerCountry) throw new Error("sellerCountry must be a two-letter country code");
  return {
    enabled: input.enabled === true,
    label: input.label?.trim() || "Tax",
    ...(sellerCountry ? { sellerCountry } : {}),
    ...(input.taxId?.trim() ? { taxId: input.taxId.trim() } : {}),
    ...(input.legalName?.trim() ? { legalName: input.legalName.trim() } : {}),
    ...(input.addressLines && input.addressLines.length > 0 ? { addressLines: input.addressLines.map((l) => l.trim()).filter(Boolean) } : {}),
    defaultRateBps: bps(input.defaultRateBps ?? 0, "defaultRateBps"),
    rates,
    reverseCharge: input.reverseCharge === true,
  };
}

/** The tax a buyer owes, or null when the seller does not charge tax. */
export function resolveCheckoutTax(settings: TaxSettings | undefined, buyer: BuyerTaxInput = {}): CheckoutTaxResult | null {
  if (!settings?.enabled) return null;
  const country = normalizeCountry(buyer.country) ?? settings.sellerCountry;
  const vatId = normalizeVatId(buyer.vatId);
  const base = {
    label: settings.label,
    ...(country ? { country } : {}),
    ...(vatId ? { vatId } : {}),
  };
  if (
    settings.reverseCharge &&
    isEuCountry(country) &&
    isEuCountry(settings.sellerCountry) &&
    country !== settings.sellerCountry &&
    isVatIdShape(vatId, country)
  ) {
    return { ...base, rateBps: 0, jurisdiction: country!, reverseCharge: true };
  }
  const rateBps = (country ? settings.rates[country] : undefined) ?? settings.defaultRateBps;
  return { ...base, rateBps, jurisdiction: country ?? "default", reverseCharge: false };
}
