import {
  pgTable,
  text,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants } from "./accounts.js";
import {
  idColumn,
  timestamps,
  metadataColumn,
  amountColumn,
  requiredTimestamp,
} from "./_shared.js";

/** An autonomous-agent-callable service exposed for x402-style metered access. */
export const agentServices = pgTable(
  "agent_services",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    endpointUrl: text("endpoint_url").notNull(),
    currency: text("currency").notNull().default("USDC"),
    pricePerCall: amountColumn("price_per_call").notNull(),
    status: text("status").notNull().default("active"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("agent_services_merchant_id_idx").on(table.merchantId),
  }),
);

/** Structured machine-readable metadata describing a service's capabilities. */
export const agentServiceMetadata = pgTable(
  "agent_service_metadata",
  {
    id: idColumn(),
    agentServiceId: text("agent_service_id")
      .notNull()
      .references(() => agentServices.id),
    schema: jsonb("schema")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    capabilities: jsonb("capabilities")
      .$type<string[]>()
      .notNull()
      .default([]),
    rateLimit: jsonb("rate_limit")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    agentServiceIdx: index(
      "agent_service_metadata_agent_service_id_idx",
    ).on(table.agentServiceId),
  }),
);

/** An autonomous buyer (agent wallet) that consumes agent services. */
export const agentBuyers = pgTable(
  "agent_buyers",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    walletAddress: text("wallet_address").notNull(),
    label: text("label"),
    status: text("status").notNull().default("active"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("agent_buyers_merchant_id_idx").on(table.merchantId),
    walletIdx: index("agent_buyers_wallet_address_idx").on(
      table.walletAddress,
    ),
  }),
);

/** A single metered call from an agent buyer to an agent service. */
export const agentUsageEvents = pgTable(
  "agent_usage_events",
  {
    id: idColumn(),
    agentServiceId: text("agent_service_id")
      .notNull()
      .references(() => agentServices.id),
    agentBuyerId: text("agent_buyer_id"),
    paymentId: text("payment_id"),
    currency: text("currency").notNull().default("USDC"),
    amount: amountColumn("amount").notNull(),
    occurredAt: requiredTimestamp("occurred_at"),
    request: jsonb("request")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    agentServiceIdx: index(
      "agent_usage_events_agent_service_id_idx",
    ).on(table.agentServiceId),
    agentBuyerIdx: index("agent_usage_events_agent_buyer_id_idx").on(
      table.agentBuyerId,
    ),
  }),
);
