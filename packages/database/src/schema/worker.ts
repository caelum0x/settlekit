/**
 * Worker-specific persistence: the background worker's queues and idempotency
 * ledgers. The worker shares the core tables (payments, subscriptions,
 * entitlements, grants, customers, merchants) with the API; these tables hold
 * the state that is private to the worker's scheduled jobs.
 *
 * Document-projection pattern throughout: the canonical record lives in
 * `metadata.__doc`, with typed columns projected for the status/queue lookups.
 */
import { pgTable, text, integer, index, unique } from "drizzle-orm/pg-core";
import { idColumn, timestamps, metadataColumn } from "./_shared.js";

/**
 * The delivery-run queue. Each row is a `QueuedDeliveryRun` (the run plus the
 * purchase facts needed to rebuild the delivery context), keyed by the delivery
 * run id. Projects `status` so the runner can poll pending/failed runs and
 * `payment_id` so payment confirmation can flip the matching run to runnable.
 */
export const workerDeliveryQueue = pgTable(
  "worker_delivery_queue",
  {
    id: idColumn(),
    status: text("status").notNull(),
    paymentId: text("payment_id").notNull(),
    organizationId: text("organization_id").notNull(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    statusIdx: index("worker_delivery_queue_status_idx").on(table.status),
    paymentIdx: index("worker_delivery_queue_payment_id_idx").on(table.paymentId),
  }),
);

/** The webhook (re)delivery queue. Each row is a `WebhookJob`. */
export const workerWebhookJobs = pgTable(
  "worker_webhook_jobs",
  {
    id: idColumn(),
    status: text("status").notNull(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    statusIdx: index("worker_webhook_jobs_status_idx").on(table.status),
  }),
);

/**
 * Idempotency ledger for the customer-communication jobs. One row per
 * (kind, key) marks an email as already sent — replacing the in-memory
 * `sentReceipts` / `sentRenewalReminders` / `sentDunningEmails` /
 * `sentAccessEmails` sets so a re-observed payment/subscription/run never
 * triggers a duplicate send.
 */
export const workerEmailLedger = pgTable(
  "worker_email_ledger",
  {
    id: idColumn(),
    kind: text("kind").notNull(),
    ledgerKey: text("ledger_key").notNull(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    kindKeyUnique: unique("worker_email_ledger_kind_key_unique").on(table.kind, table.ledgerKey),
  }),
);

/** Per-subscription dunning attempt counter (cleared when no longer delinquent). */
export const workerDunningAttempts = pgTable(
  "worker_dunning_attempts",
  {
    id: idColumn(),
    subscriptionId: text("subscription_id").notNull().unique(),
    attempt: integer("attempt").notNull().default(0),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    subscriptionIdx: index("worker_dunning_attempts_subscription_id_idx").on(table.subscriptionId),
  }),
);
