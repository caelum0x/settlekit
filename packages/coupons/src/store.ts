/**
 * Coupon persistence abstraction + a real in-memory implementation.
 *
 * Stores key coupons by their normalized code and keep an append-only list of
 * redemption records so per-customer limits can be enforced. Everything is
 * cloned on the way in/out so stored state never aliases caller objects.
 */
import { normalizeCouponCode, type Coupon } from "./coupon.js";
import { countByCustomer, type CouponRedemption } from "./redemption.js";

/** Storage operations the coupon service depends on. */
export interface CouponStore {
  findByCode(code: string): Promise<Coupon | null>;
  save(coupon: Coupon): Promise<Coupon>;
  list(predicate?: (coupon: Coupon) => boolean): Promise<Coupon[]>;
  recordRedemption(redemption: CouponRedemption): Promise<CouponRedemption>;
  /** How many times each customer has redeemed the given coupon code. */
  redemptionsByCustomer(code: string): Promise<Record<string, number>>;
}

/** Deep clone via JSON round-trip — coupons are plain JSON-serializable data. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A real in-memory {@link CouponStore} — fully working, not a mock. */
export class InMemoryCouponStore implements CouponStore {
  private readonly byCode = new Map<string, Coupon>();
  private readonly redemptions: CouponRedemption[] = [];

  async findByCode(code: string): Promise<Coupon | null> {
    const found = this.byCode.get(normalizeCouponCode(code));
    return found ? clone(found) : null;
  }

  async save(coupon: Coupon): Promise<Coupon> {
    const stored = clone(coupon);
    this.byCode.set(normalizeCouponCode(stored.code), stored);
    return clone(stored);
  }

  async list(predicate?: (coupon: Coupon) => boolean): Promise<Coupon[]> {
    const all = [...this.byCode.values()].map(clone);
    return predicate ? all.filter(predicate) : all;
  }

  async recordRedemption(redemption: CouponRedemption): Promise<CouponRedemption> {
    const stored = clone(redemption);
    this.redemptions.push(stored);
    return clone(stored);
  }

  async redemptionsByCustomer(code: string): Promise<Record<string, number>> {
    const normalized = normalizeCouponCode(code);
    return countByCustomer(this.redemptions.filter((r) => normalizeCouponCode(r.couponCode) === normalized));
  }
}
