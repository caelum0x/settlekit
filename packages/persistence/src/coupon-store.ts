/**
 * Postgres-backed {@link CouponStore}. Coupons are keyed by their normalized
 * code (they carry no id); the canonical {@link Coupon} lives in
 * `metadata.__doc` and typed columns are projected for querying. Redemptions
 * are an append-only log in `coupon_redemptions`, used to derive per-customer
 * counts for per-customer limits.
 */
import { eq, type Database, coupons, couponRedemptions } from "@settlekit/database";
import { generateSecret } from "@settlekit/common";
import {
  normalizeCouponCode,
  countByCustomer,
  type Coupon,
  type CouponRedemption,
  type CouponStore,
} from "@settlekit/coupons";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

/** Convert an optional ISO timestamp to a Date for a `timestamptz` column. */
function toDate(iso: string | undefined): Date | null {
  return iso ? new Date(iso) : null;
}

export class PgCouponStore implements CouponStore {
  constructor(private readonly db: Database) {}

  async findByCode(code: string): Promise<Coupon | null> {
    const rows = await this.db
      .select({ metadata: coupons.metadata })
      .from(coupons)
      .where(eq(coupons.code, normalizeCouponCode(code)))
      .limit(1);
    return unpackDoc<Coupon>(rows[0]);
  }

  async save(coupon: Coupon): Promise<Coupon> {
    const code = normalizeCouponCode(coupon.code);
    const projection = {
      name: coupon.name ?? null,
      status: coupon.status,
      currency: coupon.currency,
      redeemedCount: coupon.redeemedCount,
      maxRedemptions: coupon.maxRedemptions ?? null,
      startsAt: toDate(coupon.startsAt),
      expiresAt: toDate(coupon.expiresAt),
      metadata: packDoc(coupon),
    };
    await this.db
      .insert(coupons)
      .values({ id: `co_${generateSecret(12)}`, code, ...projection })
      .onConflictDoUpdate({ target: coupons.code, set: projection });
    return coupon;
  }

  async list(predicate?: (coupon: Coupon) => boolean): Promise<Coupon[]> {
    const rows = await this.db.select({ metadata: coupons.metadata }).from(coupons);
    const all = unpackDocs<Coupon>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async recordRedemption(redemption: CouponRedemption): Promise<CouponRedemption> {
    await this.db.insert(couponRedemptions).values({
      id: `cr_${generateSecret(12)}`,
      couponCode: normalizeCouponCode(redemption.couponCode),
      customerId: redemption.customerId ?? null,
      metadata: packDoc(redemption),
    });
    return redemption;
  }

  async redemptionsByCustomer(code: string): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ metadata: couponRedemptions.metadata })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponCode, normalizeCouponCode(code)));
    return countByCustomer(unpackDocs<CouponRedemption>(rows));
  }
}
