/**
 * Onchain billing (@settlekit/onchain-billing): pull-based subscriptions, their
 * per-period charges and Base escrow payments. Document-projection pattern:
 * the canonical record lives in `metadata.__doc`; typed columns are projected
 * for the charge engine's lookups. `(onchain_subscription_id, period_index)` is
 * UNIQUE — the database-level guarantee that a period is charged at most once.
 */
import { pgTable, text, integer, index, unique } from "drizzle-orm/pg-core";
import { idColumn, timestamps, metadataColumn, nullableTimestamp } from "./_shared.js";

export const onchainSubscriptions = pgTable(
  "onchain_subscriptions",
  {
    id: idColumn(),
    organizationId: text("organization_id").notNull(),
    customerId: text("customer_id").notNull(),
    status: text("status").notNull(),
    network: text("network").notNull(),
    method: text("method").notNull(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    orgIdx: index("onchain_subscriptions_org_idx").on(table.organizationId),
    customerIdx: index("onchain_subscriptions_customer_idx").on(table.customerId),
    statusIdx: index("onchain_subscriptions_status_idx").on(table.status),
  }),
);

export const onchainCharges = pgTable(
  "onchain_charges",
  {
    id: idColumn(),
    onchainSubscriptionId: text("onchain_subscription_id").notNull(),
    periodIndex: integer("period_index").notNull(),
    status: text("status").notNull(),
    leaseUntil: nullableTimestamp("lease_until"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    periodUnique: unique("onchain_charges_subscription_period_unique").on(table.onchainSubscriptionId, table.periodIndex),
    statusIdx: index("onchain_charges_status_idx").on(table.status),
  }),
);

export const onchainEscrowPayments = pgTable(
  "onchain_escrow_payments",
  {
    id: idColumn(),
    organizationId: text("organization_id").notNull(),
    status: text("status").notNull(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    orgIdx: index("onchain_escrow_payments_org_idx").on(table.organizationId),
  }),
);
