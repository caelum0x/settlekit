import {
  pgTable,
  text,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { merchants, customers } from "./accounts.js";
import {
  idColumn,
  timestamps,
  metadataColumn,
  amountColumn,
  nullableTimestamp,
  requiredTimestamp,
} from "./_shared.js";

/** An escrowed task: funds are held until acceptance criteria are met. */
export const escrowTasks = pgTable(
  "escrow_tasks",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    buyerCustomerId: text("buyer_customer_id")
      .notNull()
      .references(() => customers.id),
    sellerCustomerId: text("seller_customer_id").references(
      () => customers.id,
    ),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("created"),
    currency: text("currency").notNull().default("USDC"),
    amount: amountColumn("amount").notNull(),
    acceptanceCriteria: jsonb("acceptance_criteria")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    deadlineAt: nullableTimestamp("deadline_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("escrow_tasks_merchant_id_idx").on(table.merchantId),
    buyerIdx: index("escrow_tasks_buyer_customer_id_idx").on(
      table.buyerCustomerId,
    ),
    sellerIdx: index("escrow_tasks_seller_customer_id_idx").on(
      table.sellerCustomerId,
    ),
  }),
);

/** A deposit of funds into an escrow task. */
export const escrowFundings = pgTable(
  "escrow_fundings",
  {
    id: idColumn(),
    escrowTaskId: text("escrow_task_id")
      .notNull()
      .references(() => escrowTasks.id),
    paymentId: text("payment_id"),
    currency: text("currency").notNull().default("USDC"),
    amount: amountColumn("amount").notNull(),
    txHash: text("tx_hash"),
    fundedAt: requiredTimestamp("funded_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    escrowTaskIdx: index("escrow_fundings_escrow_task_id_idx").on(
      table.escrowTaskId,
    ),
  }),
);

/** A deliverable submitted by the seller for review. */
export const escrowSubmissions = pgTable(
  "escrow_submissions",
  {
    id: idColumn(),
    escrowTaskId: text("escrow_task_id")
      .notNull()
      .references(() => escrowTasks.id),
    submittedBy: text("submitted_by").references(() => customers.id),
    status: text("status").notNull().default("submitted"),
    artifacts: jsonb("artifacts")
      .$type<Array<{ url: string; label?: string }>>()
      .notNull()
      .default([]),
    notes: text("notes"),
    submittedAt: requiredTimestamp("submitted_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    escrowTaskIdx: index("escrow_submissions_escrow_task_id_idx").on(
      table.escrowTaskId,
    ),
  }),
);

/** A release of escrowed funds to the seller (full or partial). */
export const escrowReleases = pgTable(
  "escrow_releases",
  {
    id: idColumn(),
    escrowTaskId: text("escrow_task_id")
      .notNull()
      .references(() => escrowTasks.id),
    submissionId: text("submission_id").references(() => escrowSubmissions.id),
    currency: text("currency").notNull().default("USDC"),
    amount: amountColumn("amount").notNull(),
    txHash: text("tx_hash"),
    releasedAt: requiredTimestamp("released_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    escrowTaskIdx: index("escrow_releases_escrow_task_id_idx").on(
      table.escrowTaskId,
    ),
  }),
);

/** A refund of escrowed funds back to the buyer. */
export const escrowRefunds = pgTable(
  "escrow_refunds",
  {
    id: idColumn(),
    escrowTaskId: text("escrow_task_id")
      .notNull()
      .references(() => escrowTasks.id),
    currency: text("currency").notNull().default("USDC"),
    amount: amountColumn("amount").notNull(),
    reason: text("reason"),
    txHash: text("tx_hash"),
    refundedAt: requiredTimestamp("refunded_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    escrowTaskIdx: index("escrow_refunds_escrow_task_id_idx").on(
      table.escrowTaskId,
    ),
  }),
);

/** A buyer's review/approval decision on a submitted deliverable. */
export const escrowReviews = pgTable(
  "escrow_reviews",
  {
    id: idColumn(),
    escrowTaskId: text("escrow_task_id")
      .notNull()
      .references(() => escrowTasks.id),
    submissionId: text("submission_id").references(() => escrowSubmissions.id),
    decision: text("decision").notNull(),
    notes: text("notes"),
    reviewedAt: requiredTimestamp("reviewed_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    escrowTaskIdx: index("escrow_reviews_escrow_task_id_idx").on(
      table.escrowTaskId,
    ),
  }),
);

/** A dispute raised against an escrow task. */
export const escrowDisputes = pgTable(
  "escrow_disputes",
  {
    id: idColumn(),
    escrowTaskId: text("escrow_task_id")
      .notNull()
      .references(() => escrowTasks.id),
    raisedBy: text("raised_by").references(() => customers.id),
    status: text("status").notNull().default("open"),
    reason: text("reason").notNull(),
    resolution: text("resolution"),
    evidence: jsonb("evidence")
      .$type<Array<{ url: string; label?: string }>>()
      .notNull()
      .default([]),
    resolvedAt: nullableTimestamp("resolved_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    escrowTaskIdx: index("escrow_disputes_escrow_task_id_idx").on(
      table.escrowTaskId,
    ),
  }),
);
