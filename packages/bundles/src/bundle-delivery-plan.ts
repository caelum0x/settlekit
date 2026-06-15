import type { Bundle, DeliveryAction, DeliveryPlan, Product } from "@settlekit/common";
import { generateId, toIso } from "@settlekit/common";
import { orderMembersByBundle } from "./bundle-items.js";

/**
 * Minimal member shape required to build a delivery plan: a product plus its
 * ordered delivery actions. {@link BundleMember} is assignable to this.
 */
export interface DeliveryPlanMember {
  product: Product;
  deliveryActions: DeliveryAction[];
}

/**
 * Stable, content-based key used to de-duplicate delivery actions across
 * members. Two actions that target the same resource collapse into one.
 */
function actionKey(action: DeliveryAction): string {
  switch (action.type) {
    case "github_invite":
      return `github_invite:${action.repoId}:${action.permission ?? ""}`;
    case "github_team_add":
      return `github_team_add:${action.orgLogin}:${action.teamSlug}`;
    case "license_key_create":
      return `license_key_create:${action.policyId}`;
    case "api_key_create":
      return `api_key_create:${[...action.scopes].sort().join(",")}`;
    case "file_access_grant":
      return `file_access_grant:${action.fileId}`;
    case "discord_role_add":
      return `discord_role_add:${action.guildId}:${action.roleId}`;
    case "saas_entitlement_create":
      return `saas_entitlement_create:${stableStringify(action.features)}`;
    case "webhook_send":
      return `webhook_send:${action.url}`;
    case "email_send":
      return `email_send:${action.template}`;
  }
}

/** Deterministic JSON for an unordered record of primitive values. */
function stableStringify(record: Record<string, boolean | number | string>): string {
  return Object.keys(record)
    .sort()
    .map((key) => `${key}=${String(record[key])}`)
    .join("&");
}

/**
 * Merge the delivery actions of every bundle member into a single, ordered,
 * de-duplicated list. Order follows the bundle's `productIds`; within a member,
 * actions keep their declared order. The first occurrence of a duplicate wins.
 */
export function mergeBundleDeliveryActions(
  bundle: Bundle,
  members: readonly DeliveryPlanMember[],
): DeliveryAction[] {
  const ordered = orderMembersByBundle(bundle.productIds, members);
  const seen = new Set<string>();
  const actions: DeliveryAction[] = [];
  for (const member of ordered) {
    for (const action of member.deliveryActions) {
      const key = actionKey(action);
      if (!seen.has(key)) {
        seen.add(key);
        actions.push(action);
      }
    }
  }
  return actions;
}

/**
 * Build a single {@link DeliveryPlan} for a bundle whose actions are the
 * concatenation of each member product's delivery actions, de-duplicated and
 * ordered to match `bundle.productIds`. Pure and immutable.
 */
export function buildBundleDeliveryPlan(
  bundle: Bundle,
  productsWithDeliveryActions: readonly DeliveryPlanMember[],
  now: Date = new Date(),
): DeliveryPlan {
  return {
    id: generateId("deliveryPlan"),
    organizationId: bundle.organizationId,
    bundleId: bundle.id,
    actions: mergeBundleDeliveryActions(bundle, productsWithDeliveryActions),
    createdAt: toIso(now),
  };
}

/** Backwards-compatible alias for {@link buildBundleDeliveryPlan}. */
export const createBundleDeliveryPlan = buildBundleDeliveryPlan;
