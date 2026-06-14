import { generateId, type Bundle, type DeliveryPlan } from "@settlekit/common";
import type { BundleItem } from "./types.js";

export function createBundleDeliveryPlan(bundle: Bundle, items: BundleItem[], now = new Date()): DeliveryPlan {
  return {
    id: generateId("deliveryPlan"),
    organizationId: bundle.organizationId,
    bundleId: bundle.id,
    actions: items.flatMap((item) => item.deliveryActions),
    createdAt: now.toISOString(),
  };
}
