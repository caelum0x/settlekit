/**
 * CouponService: the application-facing API over a {@link CouponStore}.
 *
 * Handles creation (with normalized codes + conflict detection), lookup,
 * listing, validation (dry-run apply) and redemption (atomic increment + logged
 * redemption record). Returns `Result` values for expected failures so callers
 * (e.g. the HTTP layer) can map them to error envelopes without try/catch.
 */
import {
  conflict,
  err,
  money,
  notFound,
  ok,
  validationError,
  type IsoTimestamp,
  type Money,
  type Result,
  type SettleKitError,
} from "@settlekit/common";
import {
  applyCoupon,
  normalizeCouponCode,
  redeemCoupon,
  type ApplyCouponResult,
  type Coupon,
  type CouponDiscount,
  type CouponStatus,
} from "./coupon.js";
import { createRedemption } from "./redemption.js";
import type { CouponStore } from "./store.js";

/** Fields accepted when creating a coupon. */
export interface CreateCouponInput {
  code: string;
  name?: string;
  discount: CouponDiscount;
  currency?: Money["currency"];
  status?: CouponStatus;
  startsAt?: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  maxRedemptions?: number;
  perCustomerLimit?: number;
  minSubtotal?: Money;
  appliesToProductIds?: string[];
}

/** Options for validating/redeeming against a subtotal. */
export interface RedeemContext {
  customerId?: string;
  now?: Date;
}

export class CouponService {
  constructor(private readonly store: CouponStore) {}

  /** Create + persist a coupon. Conflicts if the code already exists. */
  async create(input: CreateCouponInput): Promise<Result<Coupon, SettleKitError>> {
    const code = normalizeCouponCode(input.code);
    if (code.length === 0) {
      return err(validationError("Coupon code must not be empty"));
    }
    const existing = await this.store.findByCode(code);
    if (existing) {
      return err(conflict(`Coupon ${code} already exists`));
    }
    const currency = input.currency ?? "USDC";
    if (input.discount.type === "amount" && input.discount.amountOff.currency !== currency) {
      return err(validationError("Discount amount currency must match coupon currency"));
    }
    if (input.minSubtotal && input.minSubtotal.currency !== currency) {
      return err(validationError("minSubtotal currency must match coupon currency"));
    }
    const coupon: Coupon = {
      code,
      ...(input.name !== undefined ? { name: input.name } : {}),
      discount: input.discount,
      currency,
      status: input.status ?? "active",
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
      redeemedCount: 0,
      ...(input.perCustomerLimit !== undefined ? { perCustomerLimit: input.perCustomerLimit } : {}),
      ...(input.minSubtotal !== undefined ? { minSubtotal: input.minSubtotal } : {}),
      ...(input.appliesToProductIds !== undefined ? { appliesToProductIds: input.appliesToProductIds } : {}),
    };
    return ok(await this.store.save(coupon));
  }

  /** Fetch a coupon by (any-cased) code. */
  async get(code: string): Promise<Result<Coupon, SettleKitError>> {
    const coupon = await this.store.findByCode(code);
    if (!coupon) return err(notFound(`Coupon ${normalizeCouponCode(code)} not found`));
    return ok(coupon);
  }

  /** List all coupons (optionally filtered). */
  list(predicate?: (coupon: Coupon) => boolean): Promise<Coupon[]> {
    return this.store.list(predicate);
  }

  /** Dry-run: would this coupon apply to `subtotal`? Never mutates state. */
  async validate(
    code: string,
    subtotal: Money,
    context: RedeemContext = {},
  ): Promise<Result<ApplyCouponResult, SettleKitError>> {
    const found = await this.store.findByCode(code);
    if (!found) return err(notFound(`Coupon ${normalizeCouponCode(code)} not found`));
    const priorRedemptionsByCustomer = await this.store.redemptionsByCustomer(found.code);
    return ok(
      applyCoupon(subtotal, found, {
        ...(context.now !== undefined ? { now: context.now } : {}),
        ...(context.customerId !== undefined ? { customerId: context.customerId } : {}),
        priorRedemptionsByCustomer,
      }),
    );
  }

  /**
   * Redeem a coupon against `subtotal`: validates, increments the global count
   * immutably, persists the new coupon, and logs a redemption record. Returns
   * the discount result alongside the updated coupon.
   */
  async redeem(
    code: string,
    subtotal: Money,
    context: RedeemContext = {},
  ): Promise<Result<{ coupon: Coupon; result: ApplyCouponResult }, SettleKitError>> {
    const found = await this.store.findByCode(code);
    if (!found) return err(notFound(`Coupon ${normalizeCouponCode(code)} not found`));
    const priorRedemptionsByCustomer = await this.store.redemptionsByCustomer(found.code);
    const result = applyCoupon(subtotal, found, {
      ...(context.now !== undefined ? { now: context.now } : {}),
      ...(context.customerId !== undefined ? { customerId: context.customerId } : {}),
      priorRedemptionsByCustomer,
    });
    if (!result.ok) {
      return err(validationError(`Coupon not redeemable: ${result.reason ?? "ineligible"}`, { reason: result.reason }));
    }
    const updated = await this.store.save(redeemCoupon(found));
    await this.store.recordRedemption(
      createRedemption(found.code, result.discount ?? money("0", subtotal.currency), {
        ...(context.customerId !== undefined ? { customerId: context.customerId } : {}),
        ...(context.now !== undefined ? { now: context.now } : {}),
      }),
    );
    return ok({ coupon: updated, result });
  }
}
