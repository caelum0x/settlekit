import {
  pgTable,
  text,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./accounts.js";
import { products } from "./catalog.js";
import {
  idColumn,
  timestamps,
  metadataColumn,
  nullableTimestamp,
} from "./_shared.js";

/** A declarative plan describing what happens after a successful purchase. */
export const deliveryPlans = pgTable(
  "delivery_plans",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    productId: text("product_id").references(() => products.id),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("delivery_plans_merchant_id_idx").on(table.merchantId),
    productIdx: index("delivery_plans_product_id_idx").on(table.productId),
  }),
);

/** A single configured action within a delivery plan. */
export const deliveryActions = pgTable(
  "delivery_actions",
  {
    id: idColumn(),
    deliveryPlanId: text("delivery_plan_id")
      .notNull()
      .references(() => deliveryPlans.id),
    type: text("type").notNull(),
    position: integer("position").notNull().default(0),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    deliveryPlanIdx: index("delivery_actions_delivery_plan_id_idx").on(
      table.deliveryPlanId,
    ),
  }),
);

/** One execution of a delivery plan triggered by an entitlement / payment. */
export const deliveryRuns = pgTable(
  "delivery_runs",
  {
    id: idColumn(),
    deliveryPlanId: text("delivery_plan_id")
      .notNull()
      .references(() => deliveryPlans.id),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    entitlementId: text("entitlement_id"),
    paymentId: text("payment_id"),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    actionRuns: jsonb("action_runs")
      .$type<
        Array<{
          actionId: string;
          status: string;
          output?: Record<string, unknown>;
          error?: string;
        }>
      >()
      .notNull()
      .default([]),
    startedAt: nullableTimestamp("started_at"),
    completedAt: nullableTimestamp("completed_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    deliveryPlanIdx: index("delivery_runs_delivery_plan_id_idx").on(
      table.deliveryPlanId,
    ),
    merchantIdx: index("delivery_runs_merchant_id_idx").on(table.merchantId),
  }),
);

/** An append-only log line emitted during a delivery run. */
export const deliveryLogs = pgTable(
  "delivery_logs",
  {
    id: idColumn(),
    deliveryRunId: text("delivery_run_id")
      .notNull()
      .references(() => deliveryRuns.id),
    actionId: text("action_id"),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => ({
    deliveryRunIdx: index("delivery_logs_delivery_run_id_idx").on(
      table.deliveryRunId,
    ),
  }),
);
