export type Locale = "en" | "tr" | "es";

export type TranslationCatalog = Record<string, Partial<Record<Locale, string>>>;

export function translate(catalog: TranslationCatalog, key: string, locale: Locale, fallback: Locale = "en"): string {
  return catalog[key]?.[locale] ?? catalog[key]?.[fallback] ?? key;
}

export function formatUsdc(amount: string, locale: Locale): string {
  const formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  return `${formatter.format(Number(amount))} USDC`;
}
