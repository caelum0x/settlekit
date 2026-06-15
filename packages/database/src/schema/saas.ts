import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants, customers } from "./accounts.js";
import { prices } from "./catalog.js";
import { subscriptions } from "./payments.js";
import { idColumn, timestamps, metadataColumn } from "./_shared.js";

/** A packaged SaaS plan (tier) offered by a merchant. */
export const saasPlans = pgTable(
  "saas_plans",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    priceId: text("price_id").references(() => prices.id),
    status: text("status").notNull().default("active"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("saas_plans_merchant_id_idx").on(table.merchantId),
  }),
);

/** A feature flag / metered capability attached to a plan. */
export const saasFeatures = pgTable(
  "saas_features",
  {
    id: idColumn(),
    planId: text("plan_id")
      .notNull()
      .references(() => saasPlans.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("boolean"),
    value: jsonb("value")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    limit: integer("limit"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    planIdx: index("saas_features_plan_id_idx").on(table.planId),
  }),
);

/** A seat allocated within a subscription. */
export const saasSeats = pgTable(
  "saas_seats",
  {
    id: idColumn(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    customerId: text("customer_id").references(() => customers.id),
    email: text("email"),
    status: text("status").notNull().default("active"),
    assigned: boolean("assigned").notNull().default(false),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    subscriptionIdx: index("saas_seats_subscription_id_idx").on(
      table.subscriptionId,
    ),
  }),
);

/** A rule mapping a plan to the entitlements it produces. */
export const saasEntitlementRules = pgTable(
  "saas_entitlement_rules",
  {
    id: idColumn(),
    planId: text("plan_id")
      .notNull()
      .references(() => saasPlans.id),
    featureKey: text("feature_key").notNull(),
    entitlementType: text("entitlement_type").notNull(),
    quantity: integer("quantity"),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    planIdx: index("saas_entitlement_rules_plan_id_idx").on(table.planId),
  }),
);
