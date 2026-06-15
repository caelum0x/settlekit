import { pgTable, text, integer, boolean, index } from "drizzle-orm/pg-core";
import { merchants } from "./accounts.js";
import {
  idColumn,
  timestamps,
  metadataColumn,
  amountColumn,
} from "./_shared.js";

/** A sellable item (one-time, subscription, usage, or bundle). */
export const products = pgTable(
  "products",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull(),
    status: text("status").notNull().default("draft"),
    deliveryMode: text("delivery_mode").notNull().default("none"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("products_merchant_id_idx").on(table.merchantId),
  }),
);

/** A priced configuration for a product. */
export const prices = pgTable(
  "prices",
  {
    id: idColumn(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    currency: text("currency").notNull().default("USDC"),
    unitAmount: amountColumn("unit_amount").notNull(),
    interval: text("interval"),
    intervalCount: integer("interval_count"),
    usageMeterId: text("usage_meter_id"),
    active: boolean("active").notNull().default(true),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    productIdx: index("prices_product_id_idx").on(table.productId),
  }),
);

/** A grouping of products sold together. */
export const bundles = pgTable(
  "bundles",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    name: text("name").notNull(),
    description: text("description"),
    currency: text("currency").notNull().default("USDC"),
    totalAmount: amountColumn("total_amount").notNull(),
    status: text("status").notNull().default("draft"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("bundles_merchant_id_idx").on(table.merchantId),
  }),
);

/** A single product line inside a bundle. */
export const bundleItems = pgTable(
  "bundle_items",
  {
    id: idColumn(),
    bundleId: text("bundle_id")
      .notNull()
      .references(() => bundles.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    priceId: text("price_id").references(() => prices.id),
    quantity: integer("quantity").notNull().default(1),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    bundleIdx: index("bundle_items_bundle_id_idx").on(table.bundleId),
    productIdx: index("bundle_items_product_id_idx").on(table.productId),
  }),
);

/** A downloadable / deliverable file artifact owned by a merchant. */
export const fileAssets = pgTable(
  "file_assets",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    productId: text("product_id").references(() => products.id),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    storageKey: text("storage_key").notNull(),
    checksum: text("checksum"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("file_assets_merchant_id_idx").on(table.merchantId),
    productIdx: index("file_assets_product_id_idx").on(table.productId),
  }),
);
