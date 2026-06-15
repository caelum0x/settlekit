/**
 * SaaS resource client. Maps to `/v1/saas`.
 *
 * Plans, feature-bearing tenant entitlements, feature verification, and seat
 * management.
 */
import type { HttpClient, RequestOptions } from "../http-client.js";

/** A SaaS plan record (shape determined by the SaaS service). */
export interface SaasPlan {
  id: string;
  productId: string;
  name: string;
  interval: "monthly" | "yearly";
  features: Record<string, boolean | number>;
  seats: number;
  [key: string]: unknown;
}

/** A SaaS tenant entitlement record. */
export interface SaasEntitlement {
  id: string;
  organizationId: string;
  customerId: string;
  planId: string;
  features: Record<string, boolean | number>;
  [key: string]: unknown;
}

/** Input for {@link SaasResource.createPlan}. */
export interface CreateSaasPlanInput {
  productId: string;
  name: string;
  interval?: "monthly" | "yearly";
  amount: string;
  features?: Record<string, boolean | number>;
  seats?: number;
}

/** Input for {@link SaasResource.grantEntitlement}. */
export interface GrantSaasEntitlementInput {
  organizationId: string;
  customerId: string;
  planId: string;
  grantedById: string;
  grantedByType?: "payment" | "subscription" | "bundle" | "manual";
  expiresAt?: string;
}

/** Input for {@link SaasResource.verifyEntitlement}. */
export interface VerifySaasEntitlementInput {
  planId: string;
  organizationId: string;
  customerId: string;
  grantedById: string;
  feature: string;
}

/** Result of verifying a SaaS feature. */
export interface VerifySaasEntitlementResult {
  feature: string;
  enabled: boolean;
  limit: number | null;
}

/** Input for {@link SaasResource.addSeat}. */
export interface AddSeatInput {
  customerId: string;
  userId: string;
  planId: string;
}

/** Input for {@link SaasResource.removeSeat}. */
export interface RemoveSeatInput {
  customerId: string;
  userId: string;
}

/** Client for SaaS endpoints. */
export class SaasResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a SaaS plan. */
  createPlan(input: CreateSaasPlanInput, options?: RequestOptions): Promise<SaasPlan> {
    return this.http.post<SaasPlan>("/v1/saas/plans", input, options);
  }

  /** List SaaS plans, optionally filtered by product. */
  listPlans(productId?: string, options?: RequestOptions): Promise<SaasPlan[]> {
    return this.http.get<SaasPlan[]>("/v1/saas/plans", {
      ...options,
      query: { ...(productId !== undefined ? { productId } : {}) },
    });
  }

  /** Grant a feature-bearing tenant entitlement from a plan. */
  grantEntitlement(input: GrantSaasEntitlementInput, options?: RequestOptions): Promise<SaasEntitlement> {
    return this.http.post<SaasEntitlement>("/v1/saas/features", input, options);
  }

  /** Verify a feature flag / limit for a tenant. */
  verifyEntitlement(
    input: VerifySaasEntitlementInput,
    options?: RequestOptions,
  ): Promise<VerifySaasEntitlementResult> {
    return this.http.post<VerifySaasEntitlementResult>("/v1/saas/entitlements/verify", input, options);
  }

  /** Assign a seat to a user. Returns the updated seat list. */
  addSeat(input: AddSeatInput, options?: RequestOptions): Promise<{ seats: unknown }> {
    return this.http.post<{ seats: unknown }>("/v1/saas/seats", input, options);
  }

  /** Release a user's seat. Returns the updated seat list. */
  removeSeat(input: RemoveSeatInput, options?: RequestOptions): Promise<{ seats: unknown }> {
    return this.http.post<{ seats: unknown }>("/v1/saas/seats/remove", input, options);
  }
}
