/**
 * Worker-side onchain billing: the shared @settlekit/onchain-billing runtime
 * over the worker's stores (Postgres when DATABASE_URL is set), with access
 * hooks that extend / suspend the core subscription, record confirmed
 * payments and expire entitlements so access-sync revokes downstream grants.
 * Built before the scheduler (Solana key parsing is async); absent config
 * leaves the subscription-charge job a no-op.
 */
import type { Database } from "@settlekit/database";
import { DunningService, InMemoryDunningStore } from "@settlekit/dunning";
import type { EmailClient } from "@settlekit/notifications";
import {
  InMemoryOnchainBillingStore,
  buildOnchainBilling,
  createAccessHooks,
  type OnchainBillingRuntime,
} from "@settlekit/onchain-billing";
import { InMemoryCheckoutRepository } from "@settlekit/payments";
import {
  DEFAULT_MERCHANT_ID,
  PgCheckoutRepository,
  PgDunningStore,
  PgOnchainBillingStore,
} from "@settlekit/persistence";
import type { Env } from "@settlekit/chains";
import type { WorkerStore } from "../stores.js";
import type { Logger } from "../logger.js";
import { createOnchainDeliveryQueue } from "./onchain-delivery.js";

export interface WorkerOnchainBillingDeps {
  env: Env;
  stores: WorkerStore;
  db: Database | null;
  email: EmailClient | null;
  logger: Logger;
  now?: () => Date;
}

export async function buildWorkerOnchainBilling(deps: WorkerOnchainBillingDeps): Promise<OnchainBillingRuntime | null> {
  const { stores, db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const hooks = createAccessHooks(
    {
      async getSubscription(id) {
        return (await stores.allSubscriptions()).find((s) => s.id === id);
      },
      async saveSubscription(subscription) {
        await stores.upsertSubscription(subscription);
      },
      async entitlementsFor(customerId, productId) {
        return (await stores.allEntitlements()).filter((e) => e.customerId === customerId && e.productId === productId);
      },
      async saveEntitlement(entitlement) {
        await stores.upsertEntitlement(entitlement);
      },
      async savePayment(payment) {
        await stores.upsertPayment(payment);
      },
      queueDelivery: createOnchainDeliveryQueue({ stores, env: deps.env, now }),
    },
    { now, onError: (message, meta) => logger.warn(message, meta) },
  );
  const runtime = await buildOnchainBilling({
    env: deps.env,
    store: db ? new PgOnchainBillingStore(db) : new InMemoryOnchainBillingStore(),
    dunning: new DunningService(db ? new PgDunningStore(db) : new InMemoryDunningStore(), now),
    checkouts: db ? new PgCheckoutRepository(db) : new InMemoryCheckoutRepository(),
    email: deps.email,
    merchantId: DEFAULT_MERCHANT_ID,
    hooks,
    logger: {
      info: (message, meta) => logger.info(message, meta),
      warn: (message, meta) => logger.warn(message, meta),
      error: (message, meta) => logger.error(message, meta),
    },
    now,
  });
  if (runtime) {
    for (const note of runtime.notes) logger.info("onchain billing", { note });
    logger.info("onchain billing enabled", {
      networks: Object.keys(runtime.assets),
      operator: runtime.operatorAddress,
      solanaDelegate: runtime.solanaDelegate,
    });
  }
  return runtime;
}
