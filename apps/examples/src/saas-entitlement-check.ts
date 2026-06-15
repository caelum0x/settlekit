/**
 * Example: SaaS entitlement check end-to-end.
 *
 * Exercises @settlekit/saas + @settlekit/entitlements for real:
 *   1. Create a SaaS plan (with feature flags, a numeric credit limit, seats).
 *   2. Grant an entitlement from a confirmed payment (delivery action carries
 *      the plan's features + credit balance).
 *   3. Verify a feature flag and a credit balance through EntitlementService.
 *   4. Spend credits and observe the new balance.
 */
import {
  InMemoryPlanStore,
  InMemorySeatStore,
  SaasService,
} from "@settlekit/saas";
import {
  EntitlementService,
  InMemoryEntitlementRepository,
} from "@settlekit/entitlements";
import type { DeliveryAction } from "@settlekit/common";
import { activeProduct, confirmedPayment, usdc } from "./support/factories.js";

export interface SaasEntitlementResult {
  planId: string;
  entitlementId: string;
  featureAllowed: boolean;
  featureValue: boolean | number | string | undefined;
  creditsBefore: number;
  creditsAfter: number;
}

export async function main(): Promise<SaasEntitlementResult> {
  const organizationId = "org_saas_example";
  const merchantId = "merch_saas_example";
  const customerId = "cust_saas_example";

  // 1. Create a plan via the real SaasService over in-memory stores.
  const product = activeProduct({
    organizationId,
    merchantId,
    name: "Pro Plan",
    type: "saas_plan",
    deliveryMode: "saas_entitlement",
  });

  const saas = new SaasService({
    plans: new InMemoryPlanStore(),
    seats: new InMemorySeatStore(),
  });

  const planResult = await saas.createPlan({
    productId: product.id,
    name: "Pro",
    interval: "monthly",
    price: usdc("49.00"),
    features: { sso: true, projects: 50, api_credits: 1000 },
    seats: 5,
  });
  if (!planResult.ok) {
    throw new Error(`plan creation failed: ${planResult.error.message}`);
  }
  const plan = planResult.value;

  // 2. Grant an entitlement from a confirmed payment. The saas_entitlement
  //    delivery action carries the plan's feature map; credits seed the balance.
  const payment = confirmedPayment({
    organizationId,
    customerId,
    amount: plan.price,
  });

  const deliveryAction: DeliveryAction = {
    type: "saas_entitlement_create",
    features: { sso: true, projects: 50 },
  };

  const repo = new InMemoryEntitlementRepository();
  const entitlements = new EntitlementService(repo);
  const entitlement = await entitlements.grantFromPayment({
    payment,
    product,
    deliveryAction,
    creditsRemaining: 1000,
  });

  // 3. Verify a feature flag.
  const featureCheck = await entitlements.verify({
    customerId,
    productId: product.id,
    feature: "sso",
  });
  if (!featureCheck.allowed) {
    throw new Error(`expected sso feature to be granted: ${featureCheck.reason}`);
  }

  // Verify there are enough credits to perform an operation costing 25.
  const creditCheck = await entitlements.verify({
    customerId,
    productId: product.id,
    requiredCredits: 25,
  });
  if (!creditCheck.allowed) {
    throw new Error(`expected sufficient credits: ${creditCheck.reason}`);
  }

  const creditsBefore = entitlement.creditsRemaining ?? 0;

  // 4. Deduct 25 credits through the service and read the persisted balance.
  const afterSpend = await entitlements.spendCredits(customerId, product.id, 25);
  const creditsAfter = afterSpend.creditsRemaining ?? 0;

  if (creditsAfter !== creditsBefore - 25) {
    throw new Error(
      `credit balance mismatch: ${creditsBefore} - 25 != ${creditsAfter}`,
    );
  }

  return {
    planId: plan.id,
    entitlementId: entitlement.id,
    featureAllowed: featureCheck.allowed,
    featureValue: featureCheck.value,
    creditsBefore,
    creditsAfter,
  };
}

/** Run when executed directly: `node --import tsx src/saas-entitlement-check.ts`. */
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((result) => {
      console.log("[saas-entitlement-check]", JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error("[saas-entitlement-check] failed", err);
      process.exitCode = 1;
    });
}
