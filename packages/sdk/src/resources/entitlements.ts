/**
 * Entitlements resource client. Maps to `/v1/entitlements`.
 *
 * The hot-path `verify` endpoint is the most-called endpoint in the SDK.
 */
import type { Entitlement } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Query options for {@link EntitlementsResource.list}. */
export interface ListEntitlementsParams {
  customerId: string;
  activeOnly?: boolean;
  productId?: string;
}

/** Input for {@link EntitlementsResource.verify}. */
export interface VerifyEntitlementInput {
  customerId: string;
  productId?: string;
  feature?: string;
  requiredCredits?: number;
}

/** Result of an entitlement verification (mirrors the API's verify response). */
export interface VerifyEntitlementResult {
  /** Whether access is granted. */
  allowed: boolean;
  /** Machine-readable reason when `allowed` is false (e.g. `no_active_entitlement`). */
  reason?: string;
  /** The matched entitlement, when access was granted. */
  entitlement?: Entitlement;
  /** Feature/credit value associated with the check, when applicable. */
  value?: boolean | number | string;
  [key: string]: unknown;
}

/** Input for {@link EntitlementsResource.spendCredits}. */
export interface SpendCreditsInput {
  customerId: string;
  productId: string;
  amount: number;
}

/** Client for entitlement endpoints. */
export class EntitlementsResource {
  constructor(private readonly http: HttpClient) {}

  /** List a customer's entitlements (optionally active-only / per product). */
  list(params: ListEntitlementsParams, options?: RequestOptions): Promise<Entitlement[]> {
    return this.http.get<Entitlement[]>("/v1/entitlements", {
      ...options,
      query: {
        customerId: params.customerId,
        ...(params.activeOnly !== undefined ? { activeOnly: params.activeOnly } : {}),
        ...(params.productId !== undefined ? { productId: params.productId } : {}),
      },
    });
  }

  /** Verify access by feature flag, credits, or product. */
  verify(input: VerifyEntitlementInput, options?: RequestOptions): Promise<VerifyEntitlementResult> {
    return this.http.post<VerifyEntitlementResult>("/v1/entitlements/verify", input, options);
  }

  /** Spend credits against a product entitlement. */
  spendCredits(input: SpendCreditsInput, options?: RequestOptions): Promise<Entitlement> {
    return this.http.post<Entitlement>("/v1/entitlements/spend-credits", input, options);
  }

  /** Retrieve an entitlement by id. */
  retrieve(id: string, options?: RequestOptions): Promise<Entitlement> {
    return this.http.get<Entitlement>(`/v1/entitlements/${encodeURIComponent(id)}`, options);
  }

  /** Revoke an entitlement with an optional reason. */
  revoke(id: string, reason?: string, options?: RequestOptions): Promise<Entitlement> {
    return this.http.post<Entitlement>(
      `/v1/entitlements/${encodeURIComponent(id)}/revoke`,
      reason !== undefined ? { reason } : {},
      options,
    );
  }
}
