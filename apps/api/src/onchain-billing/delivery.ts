/**
 * Delivery for onchain subscriptions (API side): on the first successful
 * charge and on reactivation, run the product's delivery actions (GitHub
 * invite / team, Discord role, file grant, license / API key, ...) through the
 * real handler registry — the same runner agent purchases use — and persist
 * the run so POST /v1/delivery-runs/:id/retry can re-drive failed actions.
 *
 * Idempotent per charge: a run already recorded for the charge's payment id
 * is never repeated.
 */
import { generateId, toIso, type DeliveryPlan, type Entitlement } from "@settlekit/common";
import { DeliveryRunner, deliveryActionsFor, type DeliveryContext } from "@settlekit/delivery";
import type { AccessDelivery } from "@settlekit/onchain-billing";
import type { AppContext } from "../context.js";
import { githubInstallationFor } from "../agent-payments/fulfil.js";

const INLINE_RETRY = { maxAttempts: 2, baseDelayMs: 250 } as const;

type DeliveryDeps = Omit<AppContext, "onchainBilling">;

/** The active entitlement for the subscription's product, granting one when missing. */
async function ensureEntitlement(ctx: DeliveryDeps, delivery: AccessDelivery): Promise<Entitlement | undefined> {
  const sub = delivery.subscription;
  const existing = (await ctx.entitlementRepo.listByCustomer(sub.customerId)).find(
    (e) => e.productId === sub.productId && e.status === "active",
  );
  if (existing) return existing;
  if (!sub.subscriptionId) return undefined;
  const [subscription, product] = await Promise.all([ctx.subscriptions.findById(sub.subscriptionId), ctx.products.findById(sub.productId)]);
  if (!subscription || !product) return undefined;
  return ctx.entitlements.grantFromSubscription({ subscription, product });
}

export async function deliverOnchainSubscription(ctx: DeliveryDeps, delivery: AccessDelivery): Promise<void> {
  const sub = delivery.subscription;
  const product = await ctx.products.findById(sub.productId);
  if (!product) return;
  const actions = deliveryActionsFor(product);
  if (actions.length === 0) return;
  const already = await ctx.deliveryRuns.list((run) => run.paymentId === delivery.paymentId);
  if (already.length > 0) return;

  const entitlement = await ensureEntitlement(ctx, delivery);
  if (!entitlement) throw new Error(`no entitlement to deliver against for ${sub.id}`);
  const customer = await ctx.customers.findById(sub.customerId);
  const needsGithub = actions.some((action) => action.type === "github_invite" || action.type === "github_team_add");
  const githubInstallationId = needsGithub ? await githubInstallationFor(ctx, product) : undefined;
  const email = customer?.email || sub.customerEmail;

  const plan: DeliveryPlan = {
    id: generateId("deliveryPlan"),
    organizationId: sub.organizationId,
    productId: product.id,
    actions,
    createdAt: toIso(new Date()),
  };
  const deliveryCtx: DeliveryContext = {
    organizationId: sub.organizationId,
    customerId: sub.customerId,
    productId: product.id,
    paymentId: delivery.paymentId,
    entitlementId: entitlement.id,
    ...(githubInstallationId !== undefined ? { githubInstallationId } : {}),
    ...(customer?.githubUsername ? { githubUsername: customer.githubUsername } : {}),
    ...(customer?.discordUserId ? { discordUserId: customer.discordUserId } : {}),
    ...(email ? { customerEmail: email } : {}),
    emailVariables: { reason: delivery.reason, onchainSubscriptionId: sub.id },
    clients: ctx.deliveryClients,
  };
  const runner = new DeliveryRunner(ctx.deliveryRegistry, { retry: INLINE_RETRY });
  const run = await runner.run(plan, deliveryCtx, { paymentId: delivery.paymentId, customerId: sub.customerId });
  await ctx.deliveryRuns.save(run);
}
