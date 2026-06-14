import type { Entitlement } from "@settlekit/common";

export type EntitlementDenyReason =
  | "not_found"
  | "not_active"
  | "expired"
  | "feature_missing"
  | "limit_exceeded"
  | "credits_exhausted";

export interface EntitlementDecision {
  allowed: boolean;
  reason?: EntitlementDenyReason;
  entitlement?: Entitlement;
  value?: boolean | number | string;
}

export interface VerifyEntitlementInput {
  entitlements: Entitlement[];
  customerId: string;
  productId?: string;
  feature?: string;
  resourceId?: string;
  requiredCredits?: number;
  now?: Date;
}
