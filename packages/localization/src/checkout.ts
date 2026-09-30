/**
 * Hosted checkout strings. English is the source; Spanish is complete.
 * `{name}` placeholders are filled by {@link format}.
 */
import type { Locale, TranslationCatalog } from "./index.js";

/** Locales the hosted checkout ships. */
export const CHECKOUT_LOCALES = ["en", "es"] as const satisfies readonly Locale[];
export type CheckoutLocale = (typeof CHECKOUT_LOCALES)[number];

export const CHECKOUT_MESSAGES = {
  "order.title": { en: "Order summary", es: "Resumen del pedido" },
  "order.soldBy": { en: "Sold by {merchant}", es: "Vendido por {merchant}" },
  "order.total": { en: "Total", es: "Total" },
  "order.promo": { en: "Promo", es: "Código" },
  "order.reverseCharge": { en: "{label} (reverse charge)", es: "{label} (inversión del sujeto pasivo)" },
  "pay.title": { en: "Payment", es: "Pago" },
  "pay.oneOff": { en: "Or pay for one {period} only", es: "O paga solo un {period}" },
  "pay.month": { en: "month", es: "mes" },
  "pay.year": { en: "year", es: "año" },
  "pay.subscribe": { en: "Subscribe", es: "Suscribirse" },
  "pay.amountDue": { en: "Amount due", es: "Importe a pagar" },
  "pay.network": { en: "Network", es: "Red" },
  "pay.window": { en: "Window", es: "Plazo" },
  "pay.anyToken": { en: "Pay with any token", es: "Paga con cualquier token" },
  "pay.unavailable": { en: "{network} is not available on this checkout: {reason}", es: "{network} no está disponible en este pago: {reason}" },
  "pay.chooseOther": { en: "Choose another network above.", es: "Elige otra red arriba." },
  "promo.open": { en: "Have a promo code?", es: "¿Tienes un código promocional?" },
  "promo.label": { en: "Promo code", es: "Código promocional" },
  "promo.apply": { en: "Apply", es: "Aplicar" },
  "promo.applying": { en: "Applying...", es: "Aplicando..." },
  "promo.refused": {
    en: "The promo code from your link could not be applied, so the full price is shown.",
    es: "No se pudo aplicar el código de tu enlace, así que se muestra el precio completo.",
  },
  "fx.note": {
    en: "Priced at {amount} {currency}, charged in USDC at 1 {currency} = {rate} USD ({source}, {date}), fixed for this checkout.",
    es: "Precio de {amount} {currency}, cobrado en USDC a 1 {currency} = {rate} USD ({source}, {date}), fijo para este pago.",
  },
  "tax.country": { en: "Billing country: {country}", es: "País de facturación: {country}" },
  "tax.notSet": { en: "not set", es: "sin indicar" },
  "tax.change": { en: "Change", es: "Cambiar" },
  "tax.countryLabel": { en: "Billing country (two letters, e.g. FR)", es: "País de facturación (dos letras, p. ej. ES)" },
  "tax.vatLabel": { en: "VAT ID (optional, for businesses)", es: "NIF-IVA (opcional, para empresas)" },
  "tax.update": { en: "Update total", es: "Actualizar total" },
  "success.title": { en: "Payment confirmed", es: "Pago confirmado" },
  "success.delivered": {
    en: "Your USDC payment settled and access has been delivered.",
    es: "Tu pago en USDC se liquidó y el acceso ya está entregado.",
  },
  "success.pending": {
    en: "Your USDC payment settled. Some access is still pending; details below.",
    es: "Tu pago en USDC se liquidó. Parte del acceso sigue pendiente; detalles abajo.",
  },
  "success.receipt": { en: "Receipt", es: "Recibo" },
  "success.downloadReceipt": { en: "Download receipt (PDF)", es: "Descargar recibo (PDF)" },
  "link.price": { en: "Price", es: "Precio" },
  "link.continue": { en: "Continue to payment", es: "Continuar al pago" },
  "link.opening": { en: "Opening secure checkout...", es: "Abriendo el pago seguro..." },
  "link.note": {
    en: "Pay in stablecoins on the network you prefer. Access is delivered automatically once the payment is confirmed on-chain.",
    es: "Paga con stablecoins en la red que prefieras. El acceso se entrega automáticamente cuando el pago se confirma en la cadena.",
  },
  "link.promo": { en: "Promo code {code} is applied at checkout.", es: "El código {code} se aplica al pagar." },
  "invoice.from": { en: "Invoice from {merchant}", es: "Factura de {merchant}" },
  "invoice.due": { en: "Due {date}", es: "Vence el {date}" },
  "invoice.discount": { en: "Discount", es: "Descuento" },
  "invoice.tax": { en: "Tax", es: "Impuestos" },
  "invoice.pay": { en: "Pay {amount} {currency}", es: "Pagar {amount} {currency}" },
  "invoice.paid": { en: "Paid", es: "Pagada" },
  "invoice.paidOn": { en: "Paid {date}", es: "Pagada el {date}" },
  "invoice.downloadInvoice": { en: "Download invoice (PDF)", es: "Descargar factura (PDF)" },
  "invoice.downloadReceipt": { en: "Download receipt (PDF)", es: "Descargar recibo (PDF)" },
  "footer.note": {
    en: "Payments settle in USDC. Access is delivered automatically.",
    es: "Los pagos se liquidan en USDC. El acceso se entrega automáticamente.",
  },
} as const satisfies TranslationCatalog;

export type CheckoutMessageKey = keyof typeof CHECKOUT_MESSAGES;

/**
 * Choose the checkout locale: an explicit `?lang=` / cookie value first, then
 * the browser's Accept-Language (q-weighted), else English.
 */
export function pickCheckoutLocale(acceptLanguage: string | null | undefined, explicit?: string | null): CheckoutLocale {
  const supported = new Set<string>(CHECKOUT_LOCALES);
  const want = explicit?.trim().toLowerCase().slice(0, 2);
  if (want && supported.has(want)) return want as CheckoutLocale;
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { lang: (tag ?? "").toLowerCase().slice(0, 2), q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((r) => r.lang.length === 2 && r.q > 0)
    .sort((a, b) => b.q - a.q);
  const match = ranked.find((r) => supported.has(r.lang));
  return (match?.lang as CheckoutLocale | undefined) ?? "en";
}

/** Fill `{name}` placeholders. */
export function format(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

/** A translator bound to one locale. */
export function checkoutTranslator(locale: CheckoutLocale) {
  return (key: CheckoutMessageKey, values?: Record<string, string | number>): string => {
    const entry: Partial<Record<Locale, string>> = CHECKOUT_MESSAGES[key];
    return format(entry[locale] ?? entry.en ?? key, values);
  };
}
