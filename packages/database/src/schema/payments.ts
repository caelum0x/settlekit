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
import {
  idColumn,
  timestamps,
  metadataColumn,
  amountColumn,
  nullableTimestamp,
  requiredTimestamp,
} from "./_shared.js";

/** A checkout intent: the line items and lifecycle of a single purchase flow. */
export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    customerId: text("customer_id").references(() => customers.id),
    status: text("status").notNull().default("open"),
    currency: text("currency").notNull().default("USDC"),
    amountTotal: amountColumn("amount_total").notNull(),
    lineItems: jsonb("line_items")
      .$type<
        Array<{
          priceId: string;
          quantity: number;
          amount: string;
          description?: string;
        }>
      >()
      .notNull()
      .default([]),
    successUrl: text("success_url"),
    cancelUrl: text("cancel_url"),
    expiresAt: nullableTimestamp("expires_at"),
    completedAt: nullableTimestamp("completed_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("checkout_sessions_merchant_id_idx").on(
      table.merchantId,
    ),
    customerIdx: index("checkout_sessions_customer_id_idx").on(
      table.customerId,
    ),
  }),
);

/** A settled or in-flight on-chain payment. */
export const payments = pgTable(
  "payments",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    customerId: text("customer_id").references(() => customers.id),
    checkoutSessionId: text("checkout_session_id").references(
      () => checkoutSessions.id,
    ),
    status: text("status").notNull().default("pending"),
    network: text("network").notNull(),
    currency: text("currency").notNull().default("USDC"),
    amount: amountColumn("amount").notNull(),
    txHash: text("tx_hash"),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    confirmedAt: nullableTimestamp("confirmed_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("payments_merchant_id_idx").on(table.merchantId),
    customerIdx: index("payments_customer_id_idx").on(table.customerId),
    checkoutSessionIdx: index("payments_checkout_session_id_idx").on(
      table.checkoutSessionId,
    ),
    txHashIdx: index("payments_tx_hash_idx").on(table.txHash),
  }),
);

/** A recurring subscription bound to a price. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    priceId: text("price_id")
      .notNull()
      .references(() => prices.id),
    status: text("status").notNull().default("active"),
    currentPeriodStart: requiredTimestamp("current_period_start"),
    currentPeriodEnd: requiredTimestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end")
      .notNull()
      .default(false),
    canceledAt: nullableTimestamp("canceled_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("subscriptions_merchant_id_idx").on(table.merchantId),
    customerIdx: index("subscriptions_customer_id_idx").on(table.customerId),
    priceIdx: index("subscriptions_price_id_idx").on(table.priceId),
  }),
);

/** A named usage meter definition for metered billing. */
export const usageMeters = pgTable(
  "usage_meters",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    name: text("name").notNull(),
    eventName: text("event_name").notNull(),
    aggregation: text("aggregation").notNull().default("sum"),
    unitLabel: text("unit_label"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("usage_meters_merchant_id_idx").on(table.merchantId),
  }),
);

/** A prepaid credit balance for a customer. */
export const creditBalances = pgTable(
  "credit_balances",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    currency: text("currency").notNull().default("USDC"),
    balance: amountColumn("balance").notNull(),
    reserved: amountColumn("reserved").notNull(),
    version: integer("version").notNull().default(0),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("credit_balances_merchant_id_idx").on(table.merchantId),
    customerIdx: index("credit_balances_customer_id_idx").on(table.customerId),
  }),
);
