/**
 * Promo codes on the hosted checkout.
 *
 * A buyer may apply ONE promo code while the session is open and nothing is
 * recorded against it (the same rule as switching networks): the discounted
 * total becomes the session amount, so on-chain verification expects exactly
 * that. A Zcash quote locked at the old price is dropped and re-locked at the
 * new one. Invoices and payment requests take no promo codes.
 */
import { effectiveUnitAmount, money, multiplyMoney, type CheckoutSession } from "@settlekit/common";
import { quoteSessionCoupon, withSessionDiscount, type SessionLine } from "@settlekit/persistence";

import { CheckoutError } from "./errors";
import { bindAndSave, switchableSession } from "./network-select";
import { defaultStoreDeps, type StoreDeps } from "./store";

const CODE_RE = /^[A-Za-z0-9 _-]{1,64}$/;

async function sessionLines(session: CheckoutSession, deps: StoreDeps): Promise<SessionLine[]> {
  const lines: SessionLine[] = [];
  for (const line of session.lineItems) {
    const price = await deps.backend.findPrice(line.priceId);
    if (!price || price.usageBased) continue;
    lines.push({
      productId: line.productId ?? price.productId,
      amount: multiplyMoney(money(effectiveUnitAmount(price, session.fxQuote), price.currency), line.quantity),
    });
  }
  return lines;
}

/** Apply `rawCode` to `sessionId`; returns the saved, discounted session. */
export async function applyPromoCode(
  sessionId: string,
  rawCode: unknown,
  deps: StoreDeps = defaultStoreDeps(),
  now: Date = new Date(),
): Promise<CheckoutSession> {
  if (typeof rawCode !== "string" || !CODE_RE.test(rawCode.trim())) {
    throw new CheckoutError("invalid_request", "Enter a valid promo code.");
  }
  const coupons = deps.backend.coupons;
  if (!coupons) throw new CheckoutError("invalid_request", "Promo codes are not available on this checkout.");
  const session = await switchableSession(sessionId, deps, now);
  if (session.invoiceId !== undefined) {
    throw new CheckoutError("invalid_request", "Promo codes cannot be used on invoices.");
  }
  if (session.discount !== undefined) {
    throw new CheckoutError("invalid_request", "A promo code is already applied to this checkout.");
  }
  const quote = await quoteSessionCoupon({
    store: coupons,
    code: rawCode,
    organizationId: session.organizationId,
    lines: await sessionLines(session, deps),
    ...(session.customerId !== undefined ? { customerId: session.customerId } : {}),
    now,
  });
  if (!quote.ok) throw new CheckoutError("invalid_request", quote.reason);
  const { settlementQuote: _stale, ...rest } = withSessionDiscount(session, quote);
  void _stale;
  return bindAndSave(rest, session.network, deps, now);
}
