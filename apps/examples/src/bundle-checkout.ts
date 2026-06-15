/**
 * Example: build a bundle and generate its delivery plan + entitlements.
 *
 * Exercises @settlekit/bundles for real:
 *   1. Create a Bundle from two member products (a private repo + a license).
 *   2. Build a single merged, de-duplicated DeliveryPlan for the bundle.
 *   3. Build one Entitlement per member from a confirmed payment.
 *
 * Demonstrates that one bundle purchase fans out to a multi-action delivery
 * plan and a set of per-product entitlements.
 */
import {
  createBundle,
  buildBundleDeliveryPlan,
  buildBundleEntitlements,
} from "@settlekit/bundles";
import type { BundleMember } from "@settlekit/bundles";
import type { DeliveryAction } from "@settlekit/common";
import { activeProduct, confirmedPayment, usdc } from "./support/factories.js";

export interface BundleCheckoutResult {
  bundleId: string;
  bundlePrice: string;
  deliveryPlanId: string;
  actionTypes: DeliveryAction["type"][];
  entitlementCount: number;
  entitlementTypes: string[];
}

export async function main(): Promise<BundleCheckoutResult> {
  const organizationId = "org_bundle_example";
  const merchantId = "merch_bundle_example";
  const customerId = "cust_bundle_example";

  // Member product 1: a private GitHub repo (delivered via github_invite).
  const repoProduct = activeProduct({
    organizationId,
    merchantId,
    name: "Private Toolkit Repo",
    type: "github_repo_access",
    deliveryMode: "github_invite",
  });
  const repoActions: DeliveryAction[] = [
    { type: "github_invite", repoId: "acme/private-toolkit", permission: "pull" },
  ];

  // Member product 2: a software license (delivered via license_key_create).
  const licenseProduct = activeProduct({
    organizationId,
    merchantId,
    name: "Desktop App License",
    type: "license_key",
    deliveryMode: "license_key",
  });
  const licenseActions: DeliveryAction[] = [
    { type: "license_key_create", policyId: "policy_desktop_pro" },
  ];

  // 1. Create the bundle. Price is the sum of member list prices.
  const bundle = createBundle({
    merchantId,
    organizationId,
    name: "Founder Pack",
    description: "Private repo access + a desktop license, bundled.",
    productIds: [repoProduct.id, licenseProduct.id],
    memberPrices: [usdc("99.00"), usdc("50.00")],
  });

  // 2. Build a single delivery plan merging every member's actions.
  const deliveryPlan = buildBundleDeliveryPlan(bundle, [
    { product: repoProduct, deliveryActions: repoActions },
    { product: licenseProduct, deliveryActions: licenseActions },
  ]);

  // 3. Build one entitlement per member from a confirmed payment.
  const payment = confirmedPayment({
    organizationId,
    customerId,
    amount: bundle.price,
  });

  const members: BundleMember[] = [
    {
      product: repoProduct,
      deliveryActions: repoActions,
      entitlementType: "github_repo_access",
      resourceId: "acme/private-toolkit",
      price: usdc("99.00"),
    },
    {
      product: licenseProduct,
      deliveryActions: licenseActions,
      entitlementType: "license_key",
      resourceId: "policy_desktop_pro",
      price: usdc("50.00"),
    },
  ];

  const entitlements = buildBundleEntitlements(bundle, payment, members);

  if (deliveryPlan.actions.length !== 2) {
    throw new Error(`expected 2 merged actions, got ${deliveryPlan.actions.length}`);
  }
  if (entitlements.length !== 2) {
    throw new Error(`expected 2 entitlements, got ${entitlements.length}`);
  }

  return {
    bundleId: bundle.id,
    bundlePrice: bundle.price.amount,
    deliveryPlanId: deliveryPlan.id,
    actionTypes: deliveryPlan.actions.map((a) => a.type),
    entitlementCount: entitlements.length,
    entitlementTypes: entitlements.map((e) => e.entitlementType),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((result) => {
      console.log("[bundle-checkout]", JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error("[bundle-checkout] failed", err);
      process.exitCode = 1;
    });
}
