/**
 * Postgres-backed {@link WorkerStore}.
 *
 * Reads and writes the SAME tables the API persists to — payments,
 * subscriptions, entitlements, GitHub/Discord grants, customers, merchants —
 * so the worker operates on real shared state (a payment the API records is
 * the payment the worker confirms). Worker-private queues and ledgers live in
 * the `worker_*` tables. Every record's canonical entity is stored in
 * `metadata.__doc` (the shared document-projection codec); typed columns are
 * projected for status/queue lookups.
 */
import {
  and,
  eq,
  inArray,
  packDoc,
  unpackDoc,
  unpackDocs,
  type Database,
  payments,
  subscriptions,
  entitlements,
  githubRepoAccessGrants,
  discordRoleGrants,
  customers,
  merchants,
  prices,
  organizations,
  workerDeliveryQueue,
  workerWebhookJobs,
  workerEmailLedger,
  workerDunningAttempts,
} from "@settlekit/database";
import { generateSecret } from "@settlekit/common";
import type {
  Customer,
  DiscordRoleGrant,
  Entitlement,
  GitHubRepoAccessGrant,
  Merchant,
  Payment,
  Price,
  Subscription,
} from "@settlekit/common";
import type {
  BillingInterval,
  DiscordGrantRef,
  EmailKind,
  QueuedDeliveryRun,
  WebhookJob,
  WorkerStore,
} from "../stores.js";

/** Stable default ids matching the API's seed (satisfy merchant_id FKs). */
const DEFAULT_ORG_ID = "org_settlekit_default";
const DEFAULT_MERCHANT_ID = "mch_settlekit_default";

/** Delivery-queue statuses that still need work. */
const PENDING_DELIVERY_STATUSES = ["pending", "running", "failed", "partially_failed"];

/**
 * Idempotently ensure the default organization + merchant exist so the
 * worker's payment/subscription/entitlement upserts (which project
 * `merchant_id = DEFAULT_MERCHANT_ID`) never violate the FK when the worker
 * boots before the API has seeded.
 */
export async function ensureWorkerDefaults(db: Database): Promise<void> {
  await db
    .insert(organizations)
    .values({ id: DEFAULT_ORG_ID, name: "SettleKit Default", slug: "settlekit-default", status: "active", metadata: {} })
    .onConflictDoNothing({ target: organizations.id });
  await db
    .insert(merchants)
    .values({
      id: DEFAULT_MERCHANT_ID,
      organizationId: DEFAULT_ORG_ID,
      displayName: "SettleKit Default Merchant",
      defaultCurrency: "USDC",
      status: "active",
      metadata: {},
    })
    .onConflictDoNothing({ target: merchants.id });
}

export class PgWorkerStore implements WorkerStore {
  constructor(private readonly db: Database) {}

  // --- payments ---------------------------------------------------------

  async upsertPayment(payment: Payment): Promise<Payment> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      customerId: payment.customerId ?? null,
      checkoutSessionId: payment.checkoutSessionId ?? null,
      status: payment.status,
      network: payment.network,
      currency: payment.amount.currency,
      amount: payment.amount.amount,
      txHash: payment.txHash ?? null,
      metadata: packDoc(payment),
    };
    await this.db
      .insert(payments)
      .values({ id: payment.id, ...projection })
      .onConflictDoUpdate({ target: payments.id, set: projection });
    return payment;
  }

  async getPayment(id: string): Promise<Payment | undefined> {
    const rows = await this.db.select({ metadata: payments.metadata }).from(payments).where(eq(payments.id, id)).limit(1);
    return unpackDoc<Payment>(rows[0]) ?? undefined;
  }

  async pendingPayments(): Promise<Payment[]> {
    const rows = await this.db
      .select({ metadata: payments.metadata })
      .from(payments)
      .where(eq(payments.status, "pending"));
    return unpackDocs<Payment>(rows);
  }

  async confirmedPayments(): Promise<Payment[]> {
    const rows = await this.db
      .select({ metadata: payments.metadata })
      .from(payments)
      .where(eq(payments.status, "confirmed"));
    return unpackDocs<Payment>(rows);
  }

  async confirmedPaymentsByCustomer(customerId: string): Promise<Payment[]> {
    const rows = await this.db
      .select({ metadata: payments.metadata })
      .from(payments)
      .where(and(eq(payments.status, "confirmed"), eq(payments.customerId, customerId)));
    return unpackDocs<Payment>(rows);
  }

  // --- delivery queue ---------------------------------------------------

  async enqueueDelivery(item: QueuedDeliveryRun): Promise<QueuedDeliveryRun> {
    const projection = {
      status: item.run.status,
      paymentId: item.paymentId,
      organizationId: item.organizationId,
      metadata: packDoc(item),
    };
    await this.db
      .insert(workerDeliveryQueue)
      .values({ id: item.run.id, ...projection })
      .onConflictDoUpdate({ target: workerDeliveryQueue.id, set: projection });
    return item;
  }

  async pendingDeliveryRuns(): Promise<QueuedDeliveryRun[]> {
    const rows = await this.db
      .select({ metadata: workerDeliveryQueue.metadata })
      .from(workerDeliveryQueue)
      .where(inArray(workerDeliveryQueue.status, PENDING_DELIVERY_STATUSES));
    return unpackDocs<QueuedDeliveryRun>(rows);
  }

  async succeededDeliveryRuns(): Promise<QueuedDeliveryRun[]> {
    const rows = await this.db
      .select({ metadata: workerDeliveryQueue.metadata })
      .from(workerDeliveryQueue)
      .where(eq(workerDeliveryQueue.status, "succeeded"));
    return unpackDocs<QueuedDeliveryRun>(rows);
  }

  async deliveryRunByPayment(paymentId: string): Promise<QueuedDeliveryRun | undefined> {
    const rows = await this.db
      .select({ metadata: workerDeliveryQueue.metadata })
      .from(workerDeliveryQueue)
      .where(eq(workerDeliveryQueue.paymentId, paymentId))
      .limit(1);
    return unpackDoc<QueuedDeliveryRun>(rows[0]) ?? undefined;
  }

  // --- subscriptions ----------------------------------------------------

  async upsertSubscription(subscription: Subscription): Promise<Subscription> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      customerId: subscription.customerId,
      priceId: subscription.priceId,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.currentPeriodStart),
      currentPeriodEnd: new Date(subscription.currentPeriodEnd),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      metadata: packDoc(subscription),
    };
    await this.db
      .insert(subscriptions)
      .values({ id: subscription.id, ...projection })
      .onConflictDoUpdate({ target: subscriptions.id, set: projection });
    return subscription;
  }

  async allSubscriptions(): Promise<Subscription[]> {
    const rows = await this.db.select({ metadata: subscriptions.metadata }).from(subscriptions);
    return unpackDocs<Subscription>(rows);
  }

  async getSubscriptionInterval(subscriptionId: string): Promise<BillingInterval | undefined> {
    const subRows = await this.db
      .select({ metadata: subscriptions.metadata })
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .limit(1);
    const sub = unpackDoc<Subscription>(subRows[0]);
    if (!sub) return undefined;
    const priceRows = await this.db
      .select({ metadata: prices.metadata })
      .from(prices)
      .where(eq(prices.id, sub.priceId))
      .limit(1);
    const price = unpackDoc<Price>(priceRows[0]);
    return price?.interval === "monthly" || price?.interval === "yearly" ? price.interval : undefined;
  }

  // --- entitlements -----------------------------------------------------

  async upsertEntitlement(entitlement: Entitlement): Promise<Entitlement> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      customerId: entitlement.customerId,
      productId: entitlement.productId ?? null,
      type: entitlement.entitlementType,
      status: entitlement.status,
      expiresAt: entitlement.expiresAt ? new Date(entitlement.expiresAt) : null,
      metadata: packDoc(entitlement),
    };
    await this.db
      .insert(entitlements)
      .values({ id: entitlement.id, ...projection })
      .onConflictDoUpdate({ target: entitlements.id, set: projection });
    return entitlement;
  }

  async allEntitlements(): Promise<Entitlement[]> {
    const rows = await this.db.select({ metadata: entitlements.metadata }).from(entitlements);
    return unpackDocs<Entitlement>(rows);
  }

  // --- grants -----------------------------------------------------------

  async upsertGithubGrant(grant: GitHubRepoAccessGrant): Promise<GitHubRepoAccessGrant> {
    const projection = {
      installationId: String(grant.installationId),
      customerId: grant.customerId,
      status: grant.status,
      metadata: packDoc(grant),
    };
    await this.db
      .insert(githubRepoAccessGrants)
      .values({ id: grant.id, ...projection })
      .onConflictDoUpdate({ target: githubRepoAccessGrants.id, set: projection });
    return grant;
  }

  async allGithubGrants(): Promise<GitHubRepoAccessGrant[]> {
    const rows = await this.db.select({ metadata: githubRepoAccessGrants.metadata }).from(githubRepoAccessGrants);
    return unpackDocs<GitHubRepoAccessGrant>(rows);
  }

  async upsertDiscordGrant(grant: DiscordRoleGrant): Promise<DiscordRoleGrant> {
    const projection = {
      roleId: grant.roleId,
      customerId: grant.customerId,
      status: grant.status,
      metadata: packDoc(grant),
    };
    await this.db
      .insert(discordRoleGrants)
      .values({ id: grant.id, ...projection })
      .onConflictDoUpdate({ target: discordRoleGrants.id, set: projection });
    return grant;
  }

  async allDiscordGrants(): Promise<DiscordRoleGrant[]> {
    const rows = await this.db.select({ metadata: discordRoleGrants.metadata }).from(discordRoleGrants);
    return unpackDocs<DiscordRoleGrant>(rows);
  }

  async findDiscordGrant(ref: DiscordGrantRef): Promise<DiscordRoleGrant | undefined> {
    const all = await this.allDiscordGrants();
    return all.find(
      (g) => g.guildId === ref.guildId && g.roleId === ref.roleId && g.discordUserId === ref.discordUserId,
    );
  }

  // --- webhook jobs -----------------------------------------------------

  async upsertWebhookJob(job: WebhookJob): Promise<WebhookJob> {
    const projection = { status: job.status, metadata: packDoc(job) };
    await this.db
      .insert(workerWebhookJobs)
      .values({ id: job.id, ...projection })
      .onConflictDoUpdate({ target: workerWebhookJobs.id, set: projection });
    return job;
  }

  async pendingWebhookJobs(): Promise<WebhookJob[]> {
    const rows = await this.db
      .select({ metadata: workerWebhookJobs.metadata })
      .from(workerWebhookJobs)
      .where(inArray(workerWebhookJobs.status, ["pending", "failed"]));
    return unpackDocs<WebhookJob>(rows);
  }

  // --- contacts ---------------------------------------------------------

  async getCustomer(id: string): Promise<Customer | undefined> {
    const rows = await this.db.select({ metadata: customers.metadata }).from(customers).where(eq(customers.id, id)).limit(1);
    return unpackDoc<Customer>(rows[0]) ?? undefined;
  }

  async upsertCustomer(customer: Customer): Promise<Customer> {
    const projection = {
      merchantId: (customer as { merchantId?: string }).merchantId || DEFAULT_MERCHANT_ID,
      email: customer.email,
      name: customer.name ?? null,
      walletAddress: customer.walletAddress ?? null,
      metadata: packDoc(customer),
    };
    await this.db
      .insert(customers)
      .values({ id: customer.id, ...projection })
      .onConflictDoUpdate({ target: customers.id, set: projection });
    return customer;
  }

  async findMerchantByOrg(organizationId: string): Promise<Merchant | undefined> {
    const rows = await this.db
      .select({ metadata: merchants.metadata })
      .from(merchants)
      .where(eq(merchants.organizationId, organizationId))
      .limit(1);
    return unpackDoc<Merchant>(rows[0]) ?? undefined;
  }

  async upsertMerchant(merchant: Merchant): Promise<Merchant> {
    const projection = {
      organizationId: merchant.organizationId,
      displayName: merchant.displayName,
      supportEmail: merchant.supportEmail ?? null,
      metadata: packDoc(merchant),
    };
    await this.db
      .insert(merchants)
      .values({ id: merchant.id, ...projection })
      .onConflictDoUpdate({ target: merchants.id, set: projection });
    return merchant;
  }

  // --- dunning attempts -------------------------------------------------

  async getDunningAttempt(subscriptionId: string): Promise<number | undefined> {
    const rows = await this.db
      .select({ attempt: workerDunningAttempts.attempt })
      .from(workerDunningAttempts)
      .where(eq(workerDunningAttempts.subscriptionId, subscriptionId))
      .limit(1);
    return rows[0]?.attempt;
  }

  async setDunningAttempt(subscriptionId: string, attempt: number): Promise<void> {
    const projection = { subscriptionId, attempt };
    await this.db
      .insert(workerDunningAttempts)
      .values({ id: `wda_${generateSecret(12)}`, ...projection })
      .onConflictDoUpdate({ target: workerDunningAttempts.subscriptionId, set: { attempt } });
  }

  async clearDunningAttempt(subscriptionId: string): Promise<void> {
    await this.db.delete(workerDunningAttempts).where(eq(workerDunningAttempts.subscriptionId, subscriptionId));
  }

  // --- email idempotency ledger ----------------------------------------

  async hasSentEmail(kind: EmailKind, key: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: workerEmailLedger.id })
      .from(workerEmailLedger)
      .where(and(eq(workerEmailLedger.kind, kind), eq(workerEmailLedger.ledgerKey, key)))
      .limit(1);
    return rows.length > 0;
  }

  async markEmailSent(kind: EmailKind, key: string): Promise<void> {
    await this.db
      .insert(workerEmailLedger)
      .values({ id: `wel_${generateSecret(12)}`, kind, ledgerKey: key })
      .onConflictDoNothing({ target: [workerEmailLedger.kind, workerEmailLedger.ledgerKey] });
  }
}
