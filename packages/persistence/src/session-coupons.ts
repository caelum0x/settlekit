/**
 * Promo codes at checkout, shared by the API (session create, payment links,
 * payment confirm) and the hosted checkout (promo field, payment confirm).
 *
 * A quote applies a coupon to a session's line amounts: the coupon must belong
 * to the seller, be active and within its limits, target the session's
 * products when it is product-scoped, give a monetary discount, and leave a
 * payable total above zero. The discounted total becomes the session amount,
 * so on-chain verification expects exactly the discounted amount.
 *
 * Redemption is counted once, after the payment confirmed (a buyer who
 * abandons checkout never uses up a limited code).
 */
import {
  addMoney,
  compareMoney,
  money,
  subtractMoney,
  toBaseUnits,
  type CheckoutDiscount,
  type CheckoutSession,
  type Money,
} from "@settlekit/common";
import { applyCoupon, createRedemption, normalizeCouponCode, type CouponStore } from "@settlekit/coupons";

export type { CouponStore } from "@settlekit/coupons";

/** One priced line of a session. */
export interface SessionLine {
  productId?: string;
  /** Line total (unit price x quantity). */
  amount: Money;
}

export type CouponQuote =
  | { ok: true; discount: CheckoutDiscount; total: Money }
  | { ok: false; reason: string };

const REASON: Record<string, string> = {
  archived: "This promo code is no longer active.",
  not_yet_active: "This promo code is not active yet.",
  expired: "This promo code has expired.",
  max_redemptions_reached: "This promo code has been fully used.",
  per_customer_limit_reached: "You have already used this promo code.",
  below_min_subtotal: "Your order is below this promo code's minimum.",
  currency_mismatch: "This promo code does not apply to this currency.",
};

export interface QuoteSessionCouponInput {
  store: CouponStore;
  code: string;
  organizationId: string;
  lines: readonly SessionLine[];
  customerId?: string;
  now?: Date;
}

/** Apply a promo code to a session's lines (no state change). */
export async function quoteSessionCoupon(input: QuoteSessionCouponInput): Promise<CouponQuote> {
  const code = normalizeCouponCode(input.code);
  if (code.length === 0 || code.length > 64) return { ok: false, reason: "Enter a valid promo code." };
  const coupon = await input.store.findByCode(code);
  // Another seller's code is reported exactly like an unknown one.
  if (!coupon || coupon.organizationId !== input.organizationId) {
    return { ok: false, reason: "This promo code is not valid." };
  }
  if (coupon.discount.type === "free-trial-days") {
    return { ok: false, reason: "This promo code gives a free trial and cannot be used at checkout." };
  }
  const zero = money("0");
  const subtotal = input.lines.reduce((sum, l) => addMoney(sum, money(l.amount.amount)), zero);
  const scoped = coupon.appliesToProductIds;
  const eligible =
    scoped && scoped.length > 0
      ? input.lines.filter((l) => l.productId !== undefined && scoped.includes(l.productId))
      : input.lines;
  if (eligible.length === 0) return { ok: false, reason: "This promo code does not apply to these items." };
  const eligibleSubtotal = eligible.reduce((sum, l) => addMoney(sum, money(l.amount.amount)), zero);

  const prior = input.customerId ? await input.store.redemptionsByCustomer(coupon.code) : {};
  const applied = applyCoupon(eligibleSubtotal, coupon, {
    ...(input.now ? { now: input.now } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
    priorRedemptionsByCustomer: prior,
  });
  if (!applied.ok) return { ok: false, reason: REASON[applied.reason ?? ""] ?? "This promo code cannot be used." };
  const total = subtractMoney(subtotal, applied.discount);
  if (toBaseUnits(applied.discount.amount) <= 0n) return { ok: false, reason: "This promo code gives no discount on this order." };
  if (compareMoney(total, zero) <= 0) {
    return { ok: false, reason: "This promo code covers the whole price; free orders cannot be paid onchain." };
  }
  return {
    ok: true,
    total,
    discount: { couponCode: coupon.code, subtotal, amountOff: applied.discount },
  };
}

/** A session carrying the quoted discount as its payable amount. */
export function withSessionDiscount(session: CheckoutSession, quote: Extract<CouponQuote, { ok: true }>): CheckoutSession {
  return { ...session, amount: money(quote.total.amount, session.amount.currency), discount: quote.discount };
}

/**
 * Count a confirmed session's promo redemption once. Returns the session with
 * `discount.redeemedAt` set (the caller saves it), or null when there is
 * nothing to redeem. The buyer already paid the discounted price, so the
 * count is recorded even if the code reached a limit in the meantime.
 */
export async function redeemSessionCoupon(
  store: CouponStore,
  session: CheckoutSession,
  customerId: string | undefined,
  now: Date = new Date(),
): Promise<CheckoutSession | null> {
  const discount = session.discount;
  if (!discount || discount.redeemedAt) return null;
  const coupon = await store.findByCode(discount.couponCode);
  if (coupon) {
    await store.save({ ...coupon, redeemedCount: coupon.redeemedCount + 1 });
    await store.recordRedemption(
      createRedemption(coupon.code, discount.amountOff, { ...(customerId ? { customerId } : {}), now }),
    );
  }
  return { ...session, discount: { ...discount, redeemedAt: now.toISOString() } };
}
