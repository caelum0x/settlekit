/**
 * Worker-side delivery for onchain subscriptions: when a renewal charge
 * reactivates a suspended subscription (or the worker collects a first
 * period), enqueue a pending run of the product's delivery actions on the
 * worker delivery queue; the delivery-runner job executes it with the real
 * GitHub / Discord / file / key clients on its next tick.
 *
 * Idempotent per charge (the queue is keyed by the charge's payment id).
 */
import { generateId, toIso, type DeliveryPlan, type DeliveryRun } from "@settlekit/common";
import { deliveryActionsFor } from "@settlekit/delivery";
import type { AccessDelivery } from "@settlekit/onchain-billing";
import { readEnv, type Env } from "@settlekit/chains";
import type { WorkerStore } from "../stores.js";

export interface OnchainDeliveryDeps {
  stores: WorkerStore;
  env: Env;
  now: () => Date;
}

function installationId(env: Env, pinned: unknown): number | undefined {
  if (typeof pinned === "number" && Number.isInteger(pinned) && pinned > 0) return pinned;
  const fromEnv = Number(readEnv(env, "GITHUB_APP_INSTALLATION_ID"));
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : undefined;
}

export function createOnchainDeliveryQueue(deps: OnchainDeliveryDeps): (delivery: AccessDelivery) => Promise<void> {
  return async (delivery) => {
    const { stores } = deps;
    const sub = delivery.subscription;
    if (await stores.deliveryRunByPayment(delivery.paymentId)) return;
    const product = await stores.getProduct(sub.productId);
    if (!product) return;
    const actions = deliveryActionsFor(product);
    if (actions.length === 0) return;
    const entitlement = (await stores.allEntitlements()).find(
      (e) => e.customerId === sub.customerId && e.productId === sub.productId && e.status === "active",
    );
    if (!entitlement) throw new Error(`no active entitlement to deliver against for ${sub.id}`);
    const customer = await stores.getCustomer(sub.customerId);
    const plan: DeliveryPlan = {
      id: generateId("deliveryPlan"),
      organizationId: sub.organizationId,
      productId: product.id,
      actions,
      createdAt: toIso(deps.now()),
    };
    const githubInstallationId = installationId(deps.env, product.metadata?.githubInstallationId);
    const email = customer?.email || sub.customerEmail;
    const context = {
      organizationId: sub.organizationId,
      customerId: sub.customerId,
      productId: product.id,
      paymentId: delivery.paymentId,
      entitlementId: entitlement.id,
    };
    // A pending snapshot, same shape DeliveryRunner.createRun builds.
    const run: DeliveryRun = {
      id: generateId("deliveryRun"),
      organizationId: sub.organizationId,
      paymentId: delivery.paymentId,
      customerId: sub.customerId,
      deliveryPlanId: plan.id,
      status: "pending",
      actionRuns: actions.map((action) => ({ id: generateId("deliveryAction"), action, status: "pending", attempts: 0 })),
      createdAt: toIso(deps.now()),
    };
    await stores.enqueueDelivery({
      run,
      plan,
      ...context,
      ...(githubInstallationId !== undefined ? { githubInstallationId } : {}),
      ...(customer?.githubUsername ? { githubUsername: customer.githubUsername } : {}),
      ...(customer?.discordUserId ? { discordUserId: customer.discordUserId } : {}),
      ...(email ? { customerEmail: email } : {}),
    });
  };
}
