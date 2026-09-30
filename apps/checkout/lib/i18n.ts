/**
 * Checkout language (English, Spanish). `?lang=es|en` wins, then the
 * `sk_lang` cookie, then the browser's Accept-Language.
 */
import { cookies, headers } from "next/headers";
import { checkoutTranslator, pickCheckoutLocale, type CheckoutLocale } from "@settlekit/localization";

export type { CheckoutLocale };

export function checkoutLocale(explicit?: string | null): CheckoutLocale {
  return pickCheckoutLocale(headers().get("accept-language"), explicit ?? cookies().get("sk_lang")?.value ?? null);
}

/** Translator for this request. */
export function serverT(explicit?: string | null) {
  return checkoutTranslator(checkoutLocale(explicit));
}

type T = ReturnType<typeof checkoutTranslator>;

export function orderLabels(t: T) {
  return { total: t("order.total"), promo: t("order.promo"), reverseCharge: (label: string) => t("order.reverseCharge", { label }) };
}

export function promoLabels(t: T) {
  return { open: t("promo.open"), label: t("promo.label"), apply: t("promo.apply"), applying: t("promo.applying") };
}

export function taxLabels(t: T) {
  return {
    country: t("tax.country", { country: "{country}" }),
    notSet: t("tax.notSet"),
    change: t("tax.change"),
    countryLabel: t("tax.countryLabel"),
    vatLabel: t("tax.vatLabel"),
    update: t("tax.update"),
  };
}

export function startLabels(t: T) {
  return { continue: t("link.continue"), opening: t("link.opening"), note: t("link.note") };
}
