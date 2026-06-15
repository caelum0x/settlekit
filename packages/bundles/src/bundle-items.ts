import type { DeliveryAction, EntitlementType, Money, Product } from "@settlekit/common";

/**
 * A single member of a bundle: the product, its delivery actions, and the
 * shape of the entitlement it grants. `productsWithDeliveryActions` passed to
 * the delivery-plan / entitlement builders is an array of these.
 */
export interface BundleMember {
  product: Product;
  /** Delivery actions that run when this member is purchased (in order). */
  deliveryActions: DeliveryAction[];
  /** Entitlement classification for this member's product. */
  entitlementType: EntitlementType;
  /** Optional underlying resource id (repo id, role id, file id...). */
  resourceId?: string;
  /** SaaS feature flags / limits granted, for saas_feature entitlements. */
  features?: Record<string, boolean | number | string>;
  /** Credits granted, for api_credits entitlements. */
  creditsGranted?: number;
  /** Seat allotment, for team plans. */
  seats?: number;
  /** Per-member list price, used to derive a summed bundle price. */
  price?: Money;
}

/** Extract the de-duplicated, order-preserving product ids from members. */
export function uniqueBundleProductIds(members: BundleMember[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const member of members) {
    const id = member.product.id;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Order members to match the order of `productIds` on the bundle. Members whose
 * product is not referenced by the bundle are dropped; duplicates collapse to
 * the first occurrence. Returns a new array (does not mutate the input).
 */
export function orderMembersByBundle<T extends { product: Product }>(
  productIds: readonly string[],
  members: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const member of members) {
    if (!byId.has(member.product.id)) {
      byId.set(member.product.id, member);
    }
  }
  const ordered: T[] = [];
  for (const id of productIds) {
    const member = byId.get(id);
    if (member) {
      ordered.push(member);
    }
  }
  return ordered;
}
