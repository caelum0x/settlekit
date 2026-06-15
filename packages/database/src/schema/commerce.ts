/**
 * Commerce-engine persistence: coupons, invoices, refunds, dunning, disputes,
 * and payouts. These power the post-payment money flows (discounts, billing
 * documents, reversals, recovery, chargebacks, seller payouts).
 *
 * Every table follows the document-projection pattern (see ../../apps/api codec):
 * the canonical @settlekit domain entity is stored in `metadata.__doc`, while a
 * handful of typed columns are projected for indexing and SQL/admin queries.
 */
import { pgTable, text, integer, index } from "drizzle-orm/pg-core";
import {
  idColumn,
  timestamps,
  metadataColumn,
  amountColumn,
  nullableTimestamp,
} from "./_shared.js";

/**
 * Note on references: the payment/customer/organization/subscription columns
 * below are denormalized PROJECTION columns used for indexed lookups
 * (`listByPayment`, `listByCustomer`, `listByOrganization`). They intentionally
 * carry no SQL foreign keys — the canonical entity in `metadata.__doc` is the
 * source of truth, and these columns hold whatever id the caller supplied so the
 * query paths return correct results without coupling to row existence.
 */

/** A discount coupon. Looked up by its (normalized) `code`, unique per table. */
export const coupons = pgTable(
  "coupons",
  {
    id: idColumn(),
    code: text("code").notNull().unique(),
    name: text("name"),
    status: text("status").notNull().default("active"),
    currency: text("currency").notNull().default("USDC"),
    redeemedCount: integer("redeemed_count").notNull().default(0),
    maxRedemptions: integer("max_redemptions"),
    startsAt: nullableTimestamp("starts_at"),
    expiresAt: nullableTimestamp("expires_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    statusIdx: index("coupons_status_idx").on(table.status),
  }),
);

/** An append-only log of successful coupon redemptions (per-customer limits). */
export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: idColumn(),
    couponCode: text("coupon_code").notNull(),
    customerId: text("customer_id"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    couponCodeIdx: index("coupon_redemptions_coupon_code_idx").on(table.couponCode),
    customerIdx: index("coupon_redemptions_customer_id_idx").on(table.customerId),
  }),
);

/** A customer invoice (draft → open → paid/void/uncollectible). */
export const invoices = pgTable(
  "invoices",
  {
    id: idColumn(),
    number: text("number").notNull(),
    organizationId: text("organization_id").notNull(),
    customerId: text("customer_id").notNull(),
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull().default("USDC"),
    total: amountColumn("total").notNull(),
    issuedAt: nullableTimestamp("issued_at"),
    dueAt: nullableTimestamp("due_at"),
    paidAt: nullableTimestamp("paid_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    organizationIdx: index("invoices_organization_id_idx").on(table.organizationId),
    customerIdx: index("invoices_customer_id_idx").on(table.customerId),
    statusIdx: index("invoices_status_idx").on(table.status),
  }),
);

/** A refund of (part of) a settled payment back to the buyer. */
export const refunds = pgTable(
  "refunds",
  {
    id: idColumn(),
    paymentId: text("payment_id").notNull(),
    customerId: text("customer_id").notNull(),
    currency: text("currency").notNull().default("USDC"),
    amount: amountColumn("amount").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    paymentIdx: index("refunds_payment_id_idx").on(table.paymentId),
    customerIdx: index("refunds_customer_id_idx").on(table.customerId),
    statusIdx: index("refunds_status_idx").on(table.status),
  }),
);

/** Dunning recovery state for a past-due subscription (one row per sub). */
export const dunningStates = pgTable(
  "dunning_states",
  {
    id: idColumn(),
    subscriptionId: text("subscription_id").notNull().unique(),
    status: text("status").notNull().default("active"),
    attempt: integer("attempt").notNull().default(0),
    nextAttemptAt: nullableTimestamp("next_attempt_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    statusIdx: index("dunning_states_status_idx").on(table.status),
    nextAttemptIdx: index("dunning_states_next_attempt_at_idx").on(table.nextAttemptAt),
  }),
);

/** A payment dispute / chargeback (open → under_review → won/lost/refunded). */
export const disputes = pgTable(
  "disputes",
  {
    id: idColumn(),
    paymentId: text("payment_id").notNull(),
    customerId: text("customer_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    resolvedAt: nullableTimestamp("resolved_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    paymentIdx: index("disputes_payment_id_idx").on(table.paymentId),
    customerIdx: index("disputes_customer_id_idx").on(table.customerId),
    statusIdx: index("disputes_status_idx").on(table.status),
  }),
);

/** A payout of merchant balance to an external wallet. */
export const payouts = pgTable(
  "payouts",
  {
    id: idColumn(),
    organizationId: text("organization_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    currency: text("currency").notNull().default("USDC"),
    amount: amountColumn("amount").notNull(),
    network: text("network").notNull().default("arc"),
    status: text("status").notNull().default("pending"),
    txHash: text("tx_hash"),
    failureReason: text("failure_reason"),
    paidAt: nullableTimestamp("paid_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    organizationIdx: index("payouts_organization_id_idx").on(table.organizationId),
    statusIdx: index("payouts_status_idx").on(table.status),
  }),
);
