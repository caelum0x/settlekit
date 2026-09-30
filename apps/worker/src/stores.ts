/**
 * The worker's persistence layer.
 *
 * {@link WorkerStore} is the async storage contract every scheduled job depends
 * on. Two implementations satisfy it:
 *   - {@link InMemoryWorkerStore} — a process-local data layer (Maps + Sets) used
 *     for the wiring test and for `DATABASE_URL`-less local runs. Every record is
 *     a defensive copy and updates return new objects — no in-place mutation.
 *   - {@link PgWorkerStore} (see ./db/pg-worker-store.ts) — Postgres-backed,
 *     reading/writing the SAME tables the API writes (payments, subscriptions,
 *     entitlements, grants, customers, merchants) plus the worker-private queues
 *     and ledgers, so the worker operates on real shared state.
 */

import type { WebhookDeliveryJob } from "@settlekit/persistence";
import type {
  CheckoutSession,
  Customer,
  DeliveryPlan,
  DeliveryRun,
  Entitlement,
  GitHubRepoAccessGrant,
  DiscordRoleGrant,
  Merchant,
  Payment,
  Product,
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

/**
 * A webhook delivery awaiting (re)delivery, with its attempt log (see
 * @settlekit/persistence webhook-log). Older rows without the log fields are
 * still valid.
 */
export type WebhookJob = WebhookDeliveryJob;

/** A billing cadence the worker renews against. */
export type BillingInterval = "monthly" | "yearly";

/** The kind of customer-communication email, for idempotency bookkeeping. */
export type EmailKind = "receipt" | "renewal_reminder" | "dunning" | "access_granted";

/** A Discord grant lookup key for idempotent revocation. */
export interface DiscordGrantRef {
  guildId: string;
  roleId: string;
  discordUserId: string;
}

/**
 * The async storage contract the worker's jobs and delivery wiring depend on.
 * Methods that "list" return defensive copies; "upsert" replaces by id.
 */
export interface WorkerStore {
  // --- payments ---------------------------------------------------------
  upsertPayment(payment: Payment): Promise<Payment>;
  getPayment(id: string): Promise<Payment | undefined>;
  /** Payments still awaiting on-chain confirmation. */
  pendingPayments(): Promise<Payment[]>;
  /** All confirmed (settled) payments. */
  confirmedPayments(): Promise<Payment[]>;
  /** Confirmed payments for one customer. */
  confirmedPaymentsByCustomer(customerId: string): Promise<Payment[]>;
  /**
   * The checkout session a payment settles (written by the API/checkout app).
   * Payment confirmation verifies against its payTo address and reference.
   */
  getCheckoutSession(id: string): Promise<CheckoutSession | undefined>;
  /** Every checkout session still open (the Zcash watcher scans these). */
  openCheckoutSessions(): Promise<CheckoutSession[]>;
  /** The payment already carrying `txHash` (global uniqueness), if any. */
  paymentByTxHash(txHash: string): Promise<Payment | undefined>;
  /** A catalog product (delivery configuration lives in its metadata). */
  getProduct(id: string): Promise<Product | undefined>;

  // --- delivery queue ---------------------------------------------------
  enqueueDelivery(item: QueuedDeliveryRun): Promise<QueuedDeliveryRun>;
  /** Delivery runs that have not yet reached a terminal success. */
  pendingDeliveryRuns(): Promise<QueuedDeliveryRun[]>;
  /** Delivery runs that have succeeded (for the access-granted email). */
  succeededDeliveryRuns(): Promise<QueuedDeliveryRun[]>;
  /** The queued delivery run for a payment, if any. */
  deliveryRunByPayment(paymentId: string): Promise<QueuedDeliveryRun | undefined>;

  // --- subscriptions ----------------------------------------------------
  upsertSubscription(subscription: Subscription): Promise<Subscription>;
  allSubscriptions(): Promise<Subscription[]>;
  /** Billing cadence for a subscription (from the price), or undefined. */
  getSubscriptionInterval(subscriptionId: string): Promise<BillingInterval | undefined>;

  // --- entitlements -----------------------------------------------------
  upsertEntitlement(entitlement: Entitlement): Promise<Entitlement>;
  allEntitlements(): Promise<Entitlement[]>;

  // --- grants -----------------------------------------------------------
  upsertGithubGrant(grant: GitHubRepoAccessGrant): Promise<GitHubRepoAccessGrant>;
  allGithubGrants(): Promise<GitHubRepoAccessGrant[]>;
  upsertDiscordGrant(grant: DiscordRoleGrant): Promise<DiscordRoleGrant>;
  allDiscordGrants(): Promise<DiscordRoleGrant[]>;
  /** Locate an existing Discord grant for an idempotent revoke. */
  findDiscordGrant(ref: DiscordGrantRef): Promise<DiscordRoleGrant | undefined>;

  // --- webhook jobs -----------------------------------------------------
  upsertWebhookJob(job: WebhookJob): Promise<WebhookJob>;
  /** Webhook jobs that still need a (re)delivery attempt. */
  pendingWebhookJobs(): Promise<WebhookJob[]>;
  /** The live endpoint (current secret, active flag); undefined when deleted. */
  getWebhookEndpoint(id: string): Promise<WebhookEndpoint | undefined>;
  /** Persist endpoint delivery health (failure streak, auto-disable). */
  saveWebhookEndpoint(endpoint: WebhookEndpoint): Promise<WebhookEndpoint>;

  // --- contacts ---------------------------------------------------------
  getCustomer(id: string): Promise<Customer | undefined>;
  upsertCustomer(customer: Customer): Promise<Customer>;
  findMerchantByOrg(organizationId: string): Promise<Merchant | undefined>;
  upsertMerchant(merchant: Merchant): Promise<Merchant>;

  // --- dunning attempts -------------------------------------------------
  getDunningAttempt(subscriptionId: string): Promise<number | undefined>;
  setDunningAttempt(subscriptionId: string, attempt: number): Promise<void>;
  clearDunningAttempt(subscriptionId: string): Promise<void>;

  // --- email idempotency ledger ----------------------------------------
  hasSentEmail(kind: EmailKind, key: string): Promise<boolean>;
  markEmailSent(kind: EmailKind, key: string): Promise<void>;
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
 * The process-local in-memory {@link WorkerStore}. Fully working (not a mock):
 * the same real package functions run against it as against Postgres.
 */
export class InMemoryWorkerStore implements WorkerStore {
  private readonly deliveryRuns = new Table<QueuedDeliveryRun & { id: string }>();
  private readonly paymentsTable = new Table<Payment>();
  private readonly checkoutSessionsTable = new Table<CheckoutSession>();
  private readonly subscriptionsTable = new Table<Subscription>();
  private readonly entitlementsTable = new Table<Entitlement>();
  private readonly githubGrantsTable = new Table<GitHubRepoAccessGrant>();
  private readonly discordGrantsTable = new Table<DiscordRoleGrant>();
  private readonly webhookJobsTable = new Table<WebhookJob>();
  private readonly webhookEndpointsTable = new Table<WebhookEndpoint>();
  private readonly customersTable = new Table<Customer>();
  private readonly merchantsTable = new Table<Merchant>();
  private readonly productsTable = new Table<Product>();

  private readonly subscriptionIntervals = new Map<string, BillingInterval>();
  private readonly dunningAttempts = new Map<string, number>();
  /** One Set per email kind tracking already-sent (kind, key) pairs. */
  private readonly emailLedger: Record<EmailKind, Set<string>> = {
    receipt: new Set(),
    renewal_reminder: new Set(),
    dunning: new Set(),
    access_granted: new Set(),
  };

  // --- payments ---
  async upsertPayment(payment: Payment): Promise<Payment> {
    return this.paymentsTable.upsert(payment);
  }
  async getPayment(id: string): Promise<Payment | undefined> {
    return this.paymentsTable.get(id);
  }
  async pendingPayments(): Promise<Payment[]> {
    return this.paymentsTable.filter((p) => p.status === "pending");
  }
  async confirmedPayments(): Promise<Payment[]> {
    return this.paymentsTable.filter((p) => p.status === "confirmed");
  }
  async confirmedPaymentsByCustomer(customerId: string): Promise<Payment[]> {
    return this.paymentsTable.filter((p) => p.customerId === customerId && p.status === "confirmed");
  }
  async getCheckoutSession(id: string): Promise<CheckoutSession | undefined> {
    return this.checkoutSessionsTable.get(id);
  }
  async openCheckoutSessions(): Promise<CheckoutSession[]> {
    return this.checkoutSessionsTable.filter((s) => s.status === "open");
  }
  async paymentByTxHash(txHash: string): Promise<Payment | undefined> {
    return this.paymentsTable.filter((p) => p.txHash === txHash)[0];
  }
  async getProduct(id: string): Promise<Product | undefined> {
    return this.productsTable.get(id);
  }
  /** Record a product (seeding; the API owns catalog writes in Pg). */
  async upsertProduct(product: Product): Promise<Product> {
    return this.productsTable.upsert(product);
  }
  /** Record a checkout session (upstream sync / seeding; the API owns writes in Pg). */
  async upsertCheckoutSession(session: CheckoutSession): Promise<CheckoutSession> {
    return this.checkoutSessionsTable.upsert(session);
  }

  // --- delivery queue ---
  async enqueueDelivery(item: QueuedDeliveryRun): Promise<QueuedDeliveryRun> {
    return this.deliveryRuns.upsert({ ...item, id: item.run.id });
  }
  async pendingDeliveryRuns(): Promise<QueuedDeliveryRun[]> {
    return this.deliveryRuns.filter(
      (q) =>
        q.run.status === "pending" ||
        q.run.status === "running" ||
        q.run.status === "failed" ||
        q.run.status === "partially_failed",
    );
  }
  async succeededDeliveryRuns(): Promise<QueuedDeliveryRun[]> {
    return this.deliveryRuns.filter((q) => q.run.status === "succeeded");
  }
  async deliveryRunByPayment(paymentId: string): Promise<QueuedDeliveryRun | undefined> {
    return this.deliveryRuns.filter((q) => q.paymentId === paymentId).at(0);
  }

  // --- subscriptions ---
  async upsertSubscription(subscription: Subscription): Promise<Subscription> {
    return this.subscriptionsTable.upsert(subscription);
  }
  async allSubscriptions(): Promise<Subscription[]> {
    return this.subscriptionsTable.all();
  }
  async getSubscriptionInterval(subscriptionId: string): Promise<BillingInterval | undefined> {
    return this.subscriptionIntervals.get(subscriptionId);
  }
  /** Record a subscription's billing cadence (used by upstream sync/seeding). */
  setSubscriptionInterval(subscriptionId: string, interval: BillingInterval): void {
    this.subscriptionIntervals.set(subscriptionId, interval);
  }

  // --- entitlements ---
  async upsertEntitlement(entitlement: Entitlement): Promise<Entitlement> {
    return this.entitlementsTable.upsert(entitlement);
  }
  async allEntitlements(): Promise<Entitlement[]> {
    return this.entitlementsTable.all();
  }

  // --- grants ---
  async upsertGithubGrant(grant: GitHubRepoAccessGrant): Promise<GitHubRepoAccessGrant> {
    return this.githubGrantsTable.upsert(grant);
  }
  async allGithubGrants(): Promise<GitHubRepoAccessGrant[]> {
    return this.githubGrantsTable.all();
  }
  async upsertDiscordGrant(grant: DiscordRoleGrant): Promise<DiscordRoleGrant> {
    return this.discordGrantsTable.upsert(grant);
  }
  async allDiscordGrants(): Promise<DiscordRoleGrant[]> {
    return this.discordGrantsTable.all();
  }
  async findDiscordGrant(ref: DiscordGrantRef): Promise<DiscordRoleGrant | undefined> {
    return this.discordGrantsTable
      .filter((g) => g.guildId === ref.guildId && g.roleId === ref.roleId && g.discordUserId === ref.discordUserId)
      .at(0);
  }

  // --- webhook jobs ---
  async upsertWebhookJob(job: WebhookJob): Promise<WebhookJob> {
    return this.webhookJobsTable.upsert(job);
  }
  async pendingWebhookJobs(): Promise<WebhookJob[]> {
    return this.webhookJobsTable.filter((j) => j.status === "pending" || j.status === "failed");
  }
  async getWebhookEndpoint(id: string): Promise<WebhookEndpoint | undefined> {
    return this.webhookEndpointsTable.get(id);
  }
  async saveWebhookEndpoint(endpoint: WebhookEndpoint): Promise<WebhookEndpoint> {
    return this.webhookEndpointsTable.upsert(endpoint);
  }

  // --- contacts ---
  async getCustomer(id: string): Promise<Customer | undefined> {
    return this.customersTable.get(id);
  }
  async upsertCustomer(customer: Customer): Promise<Customer> {
    return this.customersTable.upsert(customer);
  }
  async findMerchantByOrg(organizationId: string): Promise<Merchant | undefined> {
    return this.merchantsTable.filter((m) => m.organizationId === organizationId).at(0);
  }
  async upsertMerchant(merchant: Merchant): Promise<Merchant> {
    return this.merchantsTable.upsert(merchant);
  }

  // --- dunning attempts ---
  async getDunningAttempt(subscriptionId: string): Promise<number | undefined> {
    return this.dunningAttempts.get(subscriptionId);
  }
  async setDunningAttempt(subscriptionId: string, attempt: number): Promise<void> {
    this.dunningAttempts.set(subscriptionId, attempt);
  }
  async clearDunningAttempt(subscriptionId: string): Promise<void> {
    this.dunningAttempts.delete(subscriptionId);
  }

  // --- email idempotency ledger ---
  async hasSentEmail(kind: EmailKind, key: string): Promise<boolean> {
    return this.emailLedger[kind].has(key);
  }
  async markEmailSent(kind: EmailKind, key: string): Promise<void> {
    this.emailLedger[kind].add(key);
  }
}
