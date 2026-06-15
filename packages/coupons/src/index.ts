/**
 * @settlekit/coupons — the discount engine.
 *
 * Public API: the {@link Coupon} model + discount types, the pure
 * {@link applyCoupon}/{@link validateCoupon}/{@link redeemCoupon} functions,
 * redemption records, the {@link CouponStore} abstraction with a real
 * {@link InMemoryCouponStore}, and the {@link CouponService} facade.
 */
export type {
  Coupon,
  CouponDiscount,
  CouponStatus,
  CouponRejectionReason,
  ApplyCouponOptions,
  ApplyCouponResult,
} from "./coupon.js";
export { applyCoupon, validateCoupon, redeemCoupon, normalizeCouponCode } from "./coupon.js";

export type { CouponRedemption } from "./redemption.js";
export { createRedemption, countByCustomer } from "./redemption.js";

export type { CouponStore } from "./store.js";
export { InMemoryCouponStore } from "./store.js";

export type { CreateCouponInput, RedeemContext } from "./service.js";
export { CouponService } from "./service.js";
