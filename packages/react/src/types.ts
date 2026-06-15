/**
 * Shared HTTP/result types for the React bindings.
 *
 * These mirror the SettleKit API `{ data } / { error }` envelope (see
 * apps/api/src/http/respond.ts) and the entitlement verify result shape
 * (packages/entitlements/src/verify.ts), without pulling those server-only
 * packages into a browser bundle.
 */

/** Successful API envelope. */
export interface DataEnvelope<T> {
  data: T;
  error?: undefined;
}

/** Error API envelope. */
export interface ErrorEnvelope {
  data?: undefined;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Either side of the SettleKit response envelope. */
export type ApiEnvelope<T> = DataEnvelope<T> | ErrorEnvelope;

/**
 * Result of an entitlement verification (matches the API `/entitlements/verify`
 * response payload).
 */
export interface VerifyResult {
  allowed: boolean;
  /** Machine-readable reason when `allowed` is false (e.g. "feature_disabled"). */
  reason?: string;
  /** Resolved feature value or remaining credits, when applicable. */
  value?: boolean | number | string;
}

/** A checkout line item accepted by the create-checkout endpoint. */
export interface CheckoutLineItemInput {
  priceId: string;
  productId?: string;
  bundleId?: string;
  quantity?: number;
}

/** Network identifiers accepted by the checkout endpoint. */
export type CheckoutNetwork = "arc" | "base" | "ethereum";

/** Input for creating a checkout session via {@link useCheckout}. */
export interface CreateCheckoutInput {
  organizationId: string;
  merchantId: string;
  customerId?: string;
  items: CheckoutLineItemInput[];
  payToAddress: string;
  network: CheckoutNetwork;
  successUrl?: string;
  cancelUrl?: string;
  collectedFields?: Record<string, string>;
  ttlDays?: number;
}
