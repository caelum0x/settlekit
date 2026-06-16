/**
 * Coupons resource client — discount codes.
 *
 * Maps to `/v1/coupons`.
 */
import type { Money } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** A discount coupon as returned by the API. */
export interface Coupon {
  code: string;
  name?: string;
  status: "active" | "archived";
  currency: "USDC";
  redeemedCount: number;
  maxRedemptions?: number;
}

/** Discount shapes accepted on coupon creation. */
export type CouponDiscount =
  | { type: "percent"; percentOff: number }
  | { type: "amount"; amountOff: string }
  | { type: "free-trial-days"; days: number };

/** Input for {@link CouponsResource.create}. */
export interface CreateCouponInput {
  code: string;
  name?: string;
  discount: CouponDiscount;
  maxRedemptions?: number;
  perCustomerLimit?: number;
  expiresAt?: string;
}

/** Outcome of validating / redeeming a coupon against a subtotal. */
export interface CouponApplyResult {
  ok: boolean;
  discount: Money;
  total: Money;
  freeTrialDays?: number;
  reason?: string;
}

/** Client for coupon endpoints. */
export class CouponsResource {
  constructor(private readonly http: HttpClient) {}

  /** List coupons. */
  list(options?: RequestOptions): Promise<Coupon[]> {
    return this.http.get<Coupon[]>("/v1/coupons", options);
  }

  /** Create a coupon. */
  create(input: CreateCouponInput, options?: RequestOptions): Promise<Coupon> {
    return this.http.post<Coupon>("/v1/coupons", input, options);
  }

  /** Retrieve a coupon by code. */
  retrieve(code: string, options?: RequestOptions): Promise<Coupon> {
    return this.http.get<Coupon>(`/v1/coupons/${encodeURIComponent(code)}`, options);
  }

  /** Dry-run apply a coupon to a subtotal. */
  validate(code: string, input: { subtotal: string; customerId?: string }, options?: RequestOptions): Promise<CouponApplyResult> {
    return this.http.post<CouponApplyResult>(`/v1/coupons/${encodeURIComponent(code)}/validate`, input, options);
  }

  /** Redeem a coupon against a subtotal (mutates the redemption count). */
  redeem(code: string, input: { subtotal: string; customerId?: string }, options?: RequestOptions): Promise<CouponApplyResult> {
    return this.http.post<CouponApplyResult>(`/v1/coupons/${encodeURIComponent(code)}/redeem`, input, options);
  }
}
