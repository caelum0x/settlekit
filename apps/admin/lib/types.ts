import type { Money } from "@settlekit/common";

/**
 * The admin console's read/write domain model. These are flattened, UI-facing
 * shapes assembled from the SettleKit persistence schema (organizations,
 * payments, entitlements, delivery_runs, webhook_events, risk_profiles).
 *
 * They are intentionally decoupled from the drizzle row types so the same shape
 * is produced whether rows come from Postgres or the in-memory seed store.
 */

export interface AdminOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: "active" | "suspended" | "closed";
  readonly createdAt: string;
}

export interface AdminPayment {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId?: string;
  readonly status: "pending" | "confirmed" | "failed" | "refunded";
  readonly amount: Money;
  readonly network: string;
  readonly createdAt: string;
}

export type EntitlementStatus = "active" | "expired" | "revoked";

export interface AdminEntitlement {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly type: string;
  readonly status: EntitlementStatus;
  readonly createdAt: string;
}

export type DeliveryStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed";

export interface AdminDeliveryRun {
  readonly id: string;
  readonly organizationId: string;
  readonly paymentId?: string;
  readonly entitlementId?: string;
  readonly status: DeliveryStatus;
  readonly attempt: number;
  readonly actionRuns: ReadonlyArray<{
    readonly actionId: string;
    readonly status: string;
    readonly error?: string;
  }>;
  readonly lastError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminWebhookEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly type: string;
  readonly endpointUrl: string;
  readonly payload: Record<string, unknown>;
  readonly delivered: boolean;
  readonly attempts: number;
  readonly lastError?: string;
  readonly createdAt: string;
  readonly deliveredAt?: string;
}

/** A risk profile enriched with the live engine decision + manual override. */
export interface AdminRiskProfile {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly score: number;
  readonly flags: readonly string[];
  /** Engine-derived band from the score. */
  readonly decision: "allow" | "review" | "block";
  /** Reviewer override, when an analyst has actioned the queue. */
  readonly reviewState: "open" | "allowed" | "reviewing" | "blocked";
  readonly updatedAt: string;
}
