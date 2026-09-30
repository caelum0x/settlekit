/**
 * Tax on checkout sessions, shared by the API (session create, payment
 * links) and the hosted checkout (billing country / VAT ID).
 *
 * The session amount is always `net + tax`, where net is the price after any
 * promo discount. On-chain verification binds to `amount`, so the buyer pays
 * exactly the tax-inclusive total. Changing the country or applying a promo
 * recomputes from the net price, never compounding.
 */
import { addMoney, money, type CheckoutSession, type CheckoutTax, type Money } from "@settlekit/common";
import { calculateTax, resolveCheckoutTax, type BuyerTaxInput, type TaxSettings } from "@settlekit/tax";

export type { TaxSettings, BuyerTaxInput } from "@settlekit/tax";
export { normalizeTaxSettings, normalizeCountry, normalizeVatId, isEuCountry } from "@settlekit/tax";

/** The session's price before tax (after any discount). */
export function sessionNet(session: CheckoutSession): Money {
  return session.tax ? session.tax.net : session.amount;
}

/**
 * Apply the seller's tax for a buyer to a session (recomputed from the net
 * price). Returns the session unchanged, minus any tax, when tax is off.
 */
export function withSessionTax(
  session: CheckoutSession,
  settings: TaxSettings | undefined,
  buyer: BuyerTaxInput = {},
): CheckoutSession {
  const net = sessionNet(session);
  const { tax: _old, ...untaxed } = session;
  void _old;
  const resolved = resolveCheckoutTax(settings, buyer);
  if (!resolved) return { ...untaxed, amount: net };
  const calc = calculateTax(net, { jurisdiction: resolved.jurisdiction, rateBps: resolved.rateBps, inclusive: false });
  const tax: CheckoutTax = {
    net,
    amount: calc.tax,
    rateBps: resolved.rateBps,
    jurisdiction: resolved.jurisdiction,
    label: resolved.label,
    reverseCharge: resolved.reverseCharge,
    ...(resolved.country ? { country: resolved.country } : {}),
    ...(resolved.vatId ? { vatId: resolved.vatId } : {}),
  };
  return { ...untaxed, amount: addMoney(net, calc.tax), tax };
}

/** Re-apply an existing session tax (same rate) after the net price changed. */
export function retaxSession(session: CheckoutSession, net: Money): CheckoutSession {
  if (!session.tax) return { ...session, amount: net };
  const calc = calculateTax(net, { jurisdiction: session.tax.jurisdiction, rateBps: session.tax.rateBps, inclusive: false });
  return { ...session, amount: addMoney(net, calc.tax), tax: { ...session.tax, net, amount: calc.tax } };
}

/** Zero money in the session currency (helper for callers building views). */
export function zeroFor(session: CheckoutSession): Money {
  return money("0", session.amount.currency);
}
