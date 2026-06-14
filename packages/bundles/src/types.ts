import type { Bundle, DeliveryAction, Entitlement, Product } from "@settlekit/common";

export interface BundleItem {
  product: Product;
  deliveryActions: DeliveryAction[];
  entitlementTemplate?: Omit<Entitlement, "id" | "customerId" | "grantedBy" | "createdAt" | "updatedAt">;
}

export interface BundleExpansion {
  bundle: Bundle;
  productIds: string[];
  deliveryActions: DeliveryAction[];
}
