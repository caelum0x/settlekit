/**
 * API-side onchain billing: the shared @settlekit/onchain-billing runtime over
 * the API's stores (Postgres when DATABASE_URL is set — the SAME tables the
 * worker's subscription-charge job reads), with access hooks writing the
 * API's subscription / entitlement / payment repositories. The API charges
 * period 0 right after a grant is accepted; the worker charges the rest.
 */
import { DunningService } from "@settlekit/dunning";
import {
  InMemoryOnchainBillingStore,
  buildOnchainBilling,
  createAccessHooks,
  type OnchainBillingRuntime,
} from "@settlekit/onchain-billing";
import { DEFAULT_MERCHANT_ID, PgOnchainBillingStore } from "@settlekit/persistence";
import { createHyperCoreClient, createHyperCoreUsdSender, loadHyperCoreConfig, type HyperCoreUsdSender } from "@settlekit/hyperliquid";
import type { AppContext } from "../context.js";
import { deliverOnchainSubscription } from "./delivery.js";

export async function buildApiOnchainBilling(
  ctx: Omit<AppContext, "onchainBilling">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<OnchainBillingRuntime | null> {
  const hooks = createAccessHooks({
    async getSubscription(id) {
      return (await ctx.subscriptions.findById(id)) ?? undefined;
    },
    async saveSubscription(subscription) {
      await ctx.subscriptions.save(subscription);
    },
    async entitlementsFor(customerId, productId) {
      return (await ctx.entitlementRepo.listByCustomer(customerId)).filter((e) => e.productId === productId);
    },
    async saveEntitlement(entitlement) {
      await ctx.entitlementRepo.save(entitlement);
    },
    async savePayment(payment) {
      await ctx.payments.save(payment);
    },
    async queueDelivery(delivery) {
      await deliverOnchainSubscription(ctx, delivery);
    },
  }, {
    onError: (message, meta) => console.warn(`[onchain-billing] ${message}`, meta),
  });
  const hypercoreRefunds = hyperCoreRefundSender(env);
  return buildOnchainBilling({
    env,
    store: ctx.db ? new PgOnchainBillingStore(ctx.db) : new InMemoryOnchainBillingStore(),
    dunning: new DunningService(ctx.dunningStore),
    checkouts: ctx.checkouts,
    email: ctx.email,
    merchantId: DEFAULT_MERCHANT_ID,
    hooks,
    ...(hypercoreRefunds ? { hypercoreRefunds } : {}),
  });
}

/**
 * HyperCore refunds: an operator-signed `usdSend` from the onchain billing
 * operator key (HYPERCORE_REFUND_PRIVATE_KEY overrides it), when HyperCore is
 * enabled. The account must hold USDC on HyperCore to refund from.
 */
function hyperCoreRefundSender(env: Readonly<Record<string, string | undefined>>): HyperCoreUsdSender | undefined {
  const config = loadHyperCoreConfig(env);
  const key = env.HYPERCORE_REFUND_PRIVATE_KEY?.trim() || env.ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY?.trim();
  if (!config || !key) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("HYPERCORE_REFUND_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  return createHyperCoreUsdSender({ client: createHyperCoreClient(config), privateKey: key as `0x${string}` });
}
