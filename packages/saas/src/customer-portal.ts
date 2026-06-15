/**
 * Customer portal data builder (plan §20).
 *
 * Assembles the read-model a self-service billing portal renders for a customer:
 * their subscriptions (with status + renewal info) and their active SaaS
 * entitlements (with resolved feature flags + seat usage). Pure: no I/O.
 */
import type { Customer, Subscription, Entitlement } from "@settlekit/common";
import { isAccessActive } from "./grace-periods.js";

/** A subscription as presented in the portal. */
export interface PortalSubscription {
  id: string;
  productId: string;
  status: Subscription["status"];
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  graceEndsAt?: string;
  /** Whether this subscription currently grants access. */
  active: boolean;
}

/** An entitlement as presented in the portal. */
export interface PortalEntitlement {
  id: string;
  productId: string;
  entitlementType: Entitlement["entitlementType"];
  status: Entitlement["status"];
  features: Record<string, boolean | number | string>;
  seats?: number;
  expiresAt?: string;
}

/** The full portal read-model for a customer. */
export interface PortalSummary {
  customer: { id: string; email: string; name?: string };
  subscriptions: PortalSubscription[];
  entitlements: PortalEntitlement[];
  /** Whether the customer has at least one access-granting subscription. */
  hasActiveAccess: boolean;
}

function toPortalSubscription(sub: Subscription): PortalSubscription {
  return {
    id: sub.id,
    productId: sub.productId,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    ...(sub.graceEndsAt ? { graceEndsAt: sub.graceEndsAt } : {}),
    active: isAccessActive(sub),
  };
}

function toPortalEntitlement(ent: Entitlement): PortalEntitlement {
  return {
    id: ent.id,
    productId: ent.productId,
    entitlementType: ent.entitlementType,
    status: ent.status,
    features: { ...(ent.features ?? {}) },
    ...(ent.seats !== undefined ? { seats: ent.seats } : {}),
    ...(ent.expiresAt ? { expiresAt: ent.expiresAt } : {}),
  };
}

/**
 * Build the {@link PortalSummary} for a customer from their subscriptions and
 * entitlements. Inputs are filtered to the customer defensively and never
 * mutated.
 */
export function portalSummary(
  customer: Customer,
  subs: readonly Subscription[],
  entitlements: readonly Entitlement[],
): PortalSummary {
  const mySubs = subs.filter((s) => s.customerId === customer.id).map(toPortalSubscription);
  const myEnts = entitlements
    .filter((e) => e.customerId === customer.id)
    .map(toPortalEntitlement);

  return {
    customer: {
      id: customer.id,
      email: customer.email,
      ...(customer.name ? { name: customer.name } : {}),
    },
    subscriptions: mySubs,
    entitlements: myEnts,
    hasActiveAccess: mySubs.some((s) => s.active),
  };
}
