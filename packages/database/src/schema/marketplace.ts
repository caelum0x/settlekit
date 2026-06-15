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
  amountColumn,
  nullableTimestamp,
} from "./_shared.js";

/** A public marketplace listing for a product. */
export const marketplaceListings = pgTable(
  "marketplace_listings",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary"),
    category: text("category"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    currency: text("currency").notNull().default("USDC"),
    displayPrice: amountColumn("display_price"),
    status: text("status").notNull().default("draft"),
    publishedAt: nullableTimestamp("published_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("marketplace_listings_merchant_id_idx").on(
      table.merchantId,
    ),
    productIdx: index("marketplace_listings_product_id_idx").on(
      table.productId,
    ),
  }),
);

/** A computed risk score for a merchant or customer used in fraud controls. */
export const riskProfiles = pgTable(
  "risk_profiles",
  {
    id: idColumn(),
    merchantId: text("merchant_id").references(() => merchants.id),
    customerId: text("customer_id").references(() => customers.id),
    subjectType: text("subject_type").notNull(),
    score: integer("score").notNull().default(0),
    level: text("level").notNull().default("low"),
    signals: jsonb("signals")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lastEvaluatedAt: nullableTimestamp("last_evaluated_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("risk_profiles_merchant_id_idx").on(table.merchantId),
    customerIdx: index("risk_profiles_customer_id_idx").on(table.customerId),
  }),
);

/**
 * A running reputation aggregate for an agent service listing. Keyed by the
 * service id so the marketplace can sort/filter without re-scanning individual
 * reviews. The canonical AgentReputation document lives in `metadata.__doc`;
 * typed columns are projected for querying.
 */
export const agentReputations = pgTable(
  "agent_reputations",
  {
    id: idColumn(),
    serviceId: text("service_id").notNull(),
    ratingCount: integer("rating_count").notNull().default(0),
    ratingSum: integer("rating_sum").notNull().default(0),
    ratingAverage: text("rating_average"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    serviceIdx: index("agent_reputations_service_id_idx").on(table.serviceId),
  }),
);
