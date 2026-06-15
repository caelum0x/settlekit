import {
  pgTable,
  text,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants, customers } from "./accounts.js";
import { products } from "./catalog.js";
import {
  idColumn,
  timestamps,
  metadataColumn,
  nullableTimestamp,
} from "./_shared.js";

/** A granted right to access a product / feature. */
export const entitlements = pgTable(
  "entitlements",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    productId: text("product_id").references(() => products.id),
    type: text("type").notNull(),
    status: text("status").notNull().default("active"),
    featureKey: text("feature_key"),
    quantity: integer("quantity"),
    expiresAt: nullableTimestamp("expires_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("entitlements_merchant_id_idx").on(table.merchantId),
    customerIdx: index("entitlements_customer_id_idx").on(table.customerId),
    productIdx: index("entitlements_product_id_idx").on(table.productId),
  }),
);

/** A license key bound to an entitlement, optionally activation-limited. */
export const licenseKeys = pgTable(
  "license_keys",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    entitlementId: text("entitlement_id").references(() => entitlements.id),
    key: text("key").notNull().unique(),
    status: text("status").notNull().default("active"),
    maxActivations: integer("max_activations"),
    activationCount: integer("activation_count").notNull().default(0),
    activations: jsonb("activations")
      .$type<Array<{ deviceId: string; activatedAt: string }>>()
      .notNull()
      .default([]),
    expiresAt: nullableTimestamp("expires_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("license_keys_merchant_id_idx").on(table.merchantId),
    entitlementIdx: index("license_keys_entitlement_id_idx").on(
      table.entitlementId,
    ),
  }),
);

/** A hashed API key for programmatic merchant / customer access. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    hashedKey: text("hashed_key").notNull().unique(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("active"),
    lastUsedAt: nullableTimestamp("last_used_at"),
    expiresAt: nullableTimestamp("expires_at"),
    revokedAt: nullableTimestamp("revoked_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("api_keys_merchant_id_idx").on(table.merchantId),
    prefixIdx: index("api_keys_prefix_idx").on(table.prefix),
  }),
);
