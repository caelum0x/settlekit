import type { Bundle, Entitlement, Payment } from "@settlekit/common";
import { generateId, toIso } from "@settlekit/common";
import type { BundleMember } from "./bundle-items.js";
import { orderMembersByBundle } from "./bundle-items.js";

/**
 * Build one {@link Entitlement} per bundle member from a confirmed payment. All
 * resulting entitlements are linked back to the payment via
 * `grantedBy: { type: "bundle", id: payment.id }`. Order follows the bundle's
 * `productIds`; duplicate members collapse to a single entitlement. Pure and
 * immutable — inputs are never mutated.
 */
export function buildBundleEntitlements(
  bundle: Bundle,
  payment: Payment,
  members: readonly BundleMember[],
  now: Date = new Date(),
): Entitlement[] {
  const createdAt = toIso(now);
  const ordered = orderMembersByBundle(bundle.productIds, members);

  return ordered.map((member): Entitlement => {
    const entitlement: Entitlement = {
      id: generateId("entitlement"),
      organizationId: bundle.organizationId,
      customerId: payment.customerId,
      productId: member.product.id,
      grantedBy: { type: "bundle", id: payment.id },
      entitlementType: member.entitlementType,
      status: "active",
      createdAt,
      updatedAt: createdAt,
    };

    if (member.resourceId !== undefined) {
      entitlement.resourceId = member.resourceId;
    }
    if (member.features !== undefined) {
      entitlement.features = { ...member.features };
    }
    if (member.creditsGranted !== undefined) {
      entitlement.creditsRemaining = member.creditsGranted;
    }
    if (member.seats !== undefined) {
      entitlement.seats = member.seats;
    }

    return entitlement;
  });
}

/** Backwards-compatible alias for {@link buildBundleEntitlements}. */
export const createBundleEntitlements = buildBundleEntitlements;
