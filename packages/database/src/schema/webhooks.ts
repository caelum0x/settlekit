import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./accounts.js";
import {
  idColumn,
  timestamps,
  metadataColumn,
  nullableTimestamp,
} from "./_shared.js";

/** A merchant-registered destination for webhook deliveries. */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    enabledEvents: jsonb("enabled_events")
      .$type<string[]>()
      .notNull()
      .default([]),
    status: text("status").notNull().default("active"),
    disabledAt: nullableTimestamp("disabled_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("webhook_endpoints_merchant_id_idx").on(
      table.merchantId,
    ),
  }),
);

/** A single webhook event and its delivery state. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    endpointId: text("endpoint_id").references(() => webhookEndpoints.id),
    type: text("type").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    delivered: boolean("delivered").notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: nullableTimestamp("next_attempt_at"),
    deliveredAt: nullableTimestamp("delivered_at"),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("webhook_events_merchant_id_idx").on(table.merchantId),
    endpointIdx: index("webhook_events_endpoint_id_idx").on(table.endpointId),
    typeIdx: index("webhook_events_type_idx").on(table.type),
  }),
);
