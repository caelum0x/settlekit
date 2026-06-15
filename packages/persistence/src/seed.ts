/**
 * Default account seeding.
 *
 * Several tables (products, customers, checkout_sessions, payments,
 * entitlements, …) carry a NOT NULL `merchant_id` with a foreign key to
 * `merchants`, which in turn requires an `organizations` row. The domain types
 * don't all carry a merchant id, so when running against Postgres we ensure a
 * single default organization + merchant exist and project that id wherever a
 * row needs one but the domain object doesn't supply it. The document
 * (`metadata.__doc`) remains the source of truth for the entity itself.
 */

import { eq, type Database, organizations, merchants, customers } from "@settlekit/database";

/** Stable id of the platform default organization (used when none is provided). */
export const DEFAULT_ORG_ID = "org_settlekit_default";
/** Stable id of the platform default merchant (satisfies merchant_id FKs). */
export const DEFAULT_MERCHANT_ID = "mch_settlekit_default";
/** Stable id of the platform default customer (satisfies buyer_customer_id FKs). */
export const DEFAULT_CUSTOMER_ID = "cus_settlekit_default";

/**
 * Idempotently create the default organization + merchant. Safe to call on
 * every boot — uses upserts keyed on the stable ids.
 */
export async function seedDefaults(db: Database): Promise<void> {
  await db
    .insert(organizations)
    .values({
      id: DEFAULT_ORG_ID,
      name: "SettleKit Default",
      slug: "settlekit-default",
      status: "active",
      metadata: {},
    })
    .onConflictDoNothing({ target: organizations.id });

  await db
    .insert(merchants)
    .values({
      id: DEFAULT_MERCHANT_ID,
      organizationId: DEFAULT_ORG_ID,
      displayName: "SettleKit Default Merchant",
      defaultCurrency: "USDC",
      status: "active",
      metadata: {},
    })
    .onConflictDoNothing({ target: merchants.id });

  await db
    .insert(customers)
    .values({
      id: DEFAULT_CUSTOMER_ID,
      merchantId: DEFAULT_MERCHANT_ID,
      email: "default@settlekit.local",
      metadata: {},
    })
    .onConflictDoNothing({ target: customers.id });
}

/** True when the default organization row already exists. */
export async function defaultsExist(db: Database): Promise<boolean> {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, DEFAULT_ORG_ID))
    .limit(1);
  return rows.length > 0;
}
