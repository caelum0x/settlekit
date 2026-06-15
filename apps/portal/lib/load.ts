// Shared customer-scoped loaders used by the portal's server components.
// Each page resolves the customer record, their entitlements (the universal
// access layer), and a product-name lookup in one place so the views stay thin.

import { api, productNameMap } from "./api";
import type { Customer, Entitlement } from "./types";

export interface CustomerScope {
  customer: Customer | null;
  customerId: string;
  entitlements: Entitlement[];
  productNames: Map<string, string>;
  error: string | null;
}

/** Load everything a customer-scoped page needs in parallel. */
export async function loadCustomerScope(customerId: string): Promise<CustomerScope> {
  const [customerRes, entitlementsRes, productsRes] = await Promise.all([
    api.customer.get(customerId),
    api.entitlements.list(customerId),
    api.products.list(),
  ]);

  return {
    customer: customerRes.data,
    customerId,
    entitlements: entitlementsRes.data,
    productNames: productNameMap(productsRes.data),
    error: customerRes.error ?? entitlementsRes.error,
  };
}

/** Filter entitlements to a subset of access types. */
export function entitlementsOfType(
  entitlements: Entitlement[],
  types: Entitlement["entitlementType"][],
): Entitlement[] {
  const set = new Set(types);
  return entitlements.filter((e) => set.has(e.entitlementType));
}

/** Count entitlements that are currently active. */
export function countActive(entitlements: Entitlement[]): number {
  return entitlements.filter((e) => e.status === "active").length;
}

/** Distinct payment ids that granted the given entitlements. */
export function paymentIdsFrom(entitlements: Entitlement[]): string[] {
  const ids = new Set<string>();
  for (const e of entitlements) {
    if (e.grantedBy?.type === "payment" && e.grantedBy.id) ids.add(e.grantedBy.id);
  }
  return [...ids];
}

/** Distinct subscription ids that granted the given entitlements. */
export function subscriptionIdsFrom(entitlements: Entitlement[]): string[] {
  const ids = new Set<string>();
  for (const e of entitlements) {
    if (e.grantedBy?.type === "subscription" && e.grantedBy.id) ids.add(e.grantedBy.id);
  }
  return [...ids];
}
