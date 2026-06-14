import { generateId, type Bundle, type Entitlement } from "@settlekit/common";
import type { BundleItem } from "./types.js";

export function createBundleEntitlements(bundle: Bundle, items: BundleItem[], customerId: string, paymentId: string, now = new Date()): Entitlement[] {
  return items.flatMap((item) => {
    if (!item.entitlementTemplate) return [];
    return [{
      ...item.entitlementTemplate,
      id: generateId("entitlement"),
      customerId,
      grantedBy: { type: "bundle", id: paymentId },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      organizationId: bundle.organizationId,
      productId: item.product.id,
    }];
  });
}
