/**
 * Delivery actions (plan §15/§21): one payment can trigger many actions.
 * Each action is a discriminated union so the delivery runner can dispatch
 * to the correct handler with type-safe parameters.
 */
export type DeliveryAction =
  | { type: "github_invite"; repoId: string; permission?: "pull" | "push" | "maintain" }
  | { type: "github_team_add"; orgLogin: string; teamSlug: string }
  | { type: "license_key_create"; policyId: string }
  | { type: "api_key_create"; scopes: string[] }
  | { type: "file_access_grant"; fileId: string }
  | { type: "discord_role_add"; guildId: string; roleId: string }
  | { type: "saas_entitlement_create"; features: Record<string, boolean | number | string> }
  | { type: "webhook_send"; url: string }
  | { type: "email_send"; template: string };

export type DeliveryActionType = DeliveryAction["type"];

/** Ordered set of actions that should run when a product/bundle is purchased. */
export interface DeliveryPlan {
  id: string;
  organizationId: string;
  productId?: string;
  bundleId?: string;
  actions: DeliveryAction[];
  createdAt: string;
}

export type DeliveryRunStatus = "pending" | "running" | "succeeded" | "partially_failed" | "failed";

export type DeliveryActionStatus = "pending" | "running" | "succeeded" | "failed" | "rolled_back";

export interface DeliveryActionRun {
  id: string;
  action: DeliveryAction;
  status: DeliveryActionStatus;
  attempts: number;
  lastError?: string;
  /** Action output, e.g. issued license key id, github invite id. */
  output?: Record<string, unknown>;
}

export interface DeliveryRun {
  id: string;
  organizationId: string;
  paymentId: string;
  customerId: string;
  deliveryPlanId: string;
  status: DeliveryRunStatus;
  actionRuns: DeliveryActionRun[];
  createdAt: string;
  completedAt?: string;
}

export interface DeliveryLog {
  id: string;
  deliveryRunId: string;
  actionRunId: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}
