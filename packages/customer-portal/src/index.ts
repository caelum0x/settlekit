import type { ApiKey, Entitlement, LicenseKey, Payment, Subscription } from "@settlekit/common";

export interface CustomerPortalSnapshot {
  customerId: string;
  payments: Payment[];
  subscriptions: Subscription[];
  entitlements: Entitlement[];
  licenseKeys: LicenseKey[];
  apiKeys: ApiKey[];
}

export function buildCustomerPortalSnapshot(input: CustomerPortalSnapshot): CustomerPortalSnapshot {
  return {
    ...input,
    payments: [...input.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    subscriptions: [...input.subscriptions],
    entitlements: [...input.entitlements],
    licenseKeys: [...input.licenseKeys],
    apiKeys: [...input.apiKeys],
  };
}

export function activePortalEntitlements(snapshot: CustomerPortalSnapshot): Entitlement[] {
  return snapshot.entitlements.filter((entitlement) => entitlement.status === "active");
}
