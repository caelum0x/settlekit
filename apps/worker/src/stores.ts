/**
 * In-memory persistence layer shared across the worker's jobs.
 *
 * In production these would be Postgres-backed repositories from
 * `@settlekit/database`; here the worker owns a process-local set of queues and
 * tables so the jobs (and the wiring test) exercise the exact real package
 * functions against a concrete data layer. Every record is stored as a
 * defensive copy and updates return new objects — no in-place mutation.
 */

import type {
  DeliveryPlan,
  DeliveryRun,
  Entitlement,
  GitHubRepoAccessGrant,
  DiscordRoleGrant,
  Payment,
  Subscription,
  WebhookEndpoint,
  WebhookEvent,
} from "@settlekit/common";

/** A delivery run awaiting (or undergoing) execution, with its source plan. */
export interface QueuedDeliveryRun {
  run: DeliveryRun;
  plan: DeliveryPlan;
  /** Purchase facts needed to rebuild the {@link DeliveryContext}. */
  customerId: string;
  paymentId: string;
  entitlementId: string;
  productId: string;
  organizationId: string;
  githubInstallationId?: number;
  githubUsername?: string;
  discordUserId?: string;
  customerEmail?: string;
}

/** A webhook delivery awaiting (re)delivery. */
export interface WebhookJob {
  id: string;
  endpoint: WebhookEndpoint;
  event: WebhookEvent;
  status: "pending" | "delivered" | "failed";
  attempts: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Generic id-keyed table with immutable read/write semantics. */
class Table<T extends { id: string }> {
  private readonly rows = new Map<string, T>();

  upsert(row: T): T {
    const stored = clone(row);
    this.rows.set(stored.id, stored);
    return clone(stored);
  }

  get(id: string): T | undefined {
    const row = this.rows.get(id);
    return row ? clone(row) : undefined;
  }

  all(): T[] {
    return [...this.rows.values()].map(clone);
  }

  filter(predicate: (row: T) => boolean): T[] {
    return this.all().filter(predicate);
  }
}

/**
 * The concrete data layer the worker schedules against. A single instance is
 * built at boot and threaded into every job.
 */
export class WorkerStores {
  readonly deliveryRuns = new Table<QueuedDeliveryRun & { id: string }>();
  readonly payments = new Table<Payment>();
  readonly subscriptions = new Table<Subscription>();
  readonly entitlements = new Table<Entitlement>();
  readonly githubGrants = new Table<GitHubRepoAccessGrant>();
  readonly discordGrants = new Table<DiscordRoleGrant>();
  readonly webhookJobs = new Table<WebhookJob>();

  /**
   * Billing interval per subscription id. The `Subscription` record references a
   * price by id but does not carry its cadence, which `renewSubscription`
   * requires; the worker tracks it alongside the subscription it renews.
   */
  readonly subscriptionIntervals = new Map<string, "monthly" | "yearly">();

  /** Enqueue a delivery run keyed by its run id. */
  enqueueDelivery(item: QueuedDeliveryRun): QueuedDeliveryRun {
    return this.deliveryRuns.upsert({ ...item, id: item.run.id });
  }

  /** Delivery runs that have not yet reached a terminal success. */
  pendingDeliveryRuns(): Array<QueuedDeliveryRun & { id: string }> {
    return this.deliveryRuns.filter(
      (q) => q.run.status === "pending" || q.run.status === "running" || q.run.status === "failed" || q.run.status === "partially_failed",
    );
  }

  /** Payments still awaiting on-chain confirmation. */
  pendingPayments(): Payment[] {
    return this.payments.filter((p) => p.status === "pending");
  }

  /** Webhook jobs that still need a (re)delivery attempt. */
  pendingWebhookJobs(): WebhookJob[] {
    return this.webhookJobs.filter((j) => j.status === "pending" || j.status === "failed");
  }
}
