/**
 * Apply a promo code to a draft checkout session inside the API (session
 * create and payment-link visits). The discount is applied BEFORE network
 * bindings, so a locked Zcash quote already reflects the discounted amount.
 */
import { money, multiplyMoney, validationError, type CheckoutSession, type Price } from "@settlekit/common";
import { quoteSessionCoupon, withSessionDiscount, type SessionLine } from "@settlekit/persistence";
import type { AppContext } from "../context.js";

/** Line totals of a draft session from its resolved prices. */
export function linesFor(session: CheckoutSession, prices: ReadonlyMap<string, Price>): SessionLine[] {
  return session.lineItems.flatMap((line) => {
    const price = prices.get(line.priceId);
    if (!price || price.usageBased) return [];
    return [
      {
        ...(line.productId !== undefined ? { productId: line.productId } : { productId: price.productId }),
        amount: multiplyMoney(money(price.amount, price.currency), line.quantity),
      },
    ];
  });
}

/** The draft with the promo applied, or a 400 naming why the code is refused. */
export async function applyPromo(
  ctx: AppContext,
  draft: CheckoutSession,
  code: string,
  prices: ReadonlyMap<string, Price>,
): Promise<CheckoutSession> {
  const quote = await quoteSessionCoupon({
    store: ctx.couponStore,
    code,
    organizationId: draft.organizationId,
    lines: linesFor(draft, prices),
    ...(draft.customerId !== undefined ? { customerId: draft.customerId } : {}),
  });
  if (!quote.ok) throw validationError(quote.reason, { fields: { couponCode: quote.reason } });
  return withSessionDiscount(draft, quote);
}
