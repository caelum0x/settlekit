/**
 * Checkout sessions resource client. Maps to `/v1/checkout-sessions`.
 */
import type { CheckoutSession, PaymentNetwork } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** A single line item in a checkout session create request. */
export interface CheckoutLineItemInput {
  priceId: string;
  productId?: string;
  bundleId?: string;
  quantity?: number;
}

/** Input for {@link CheckoutResource.create}. */
export interface CreateCheckoutSessionInput {
  organizationId: string;
  merchantId: string;
  customerId?: string;
  items: CheckoutLineItemInput[];
  payToAddress: string;
  network: PaymentNetwork;
  successUrl?: string;
  cancelUrl?: string;
  collectedFields?: Record<string, string>;
  ttlDays?: number;
}

/** Client for checkout session endpoints. */
export class CheckoutResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a checkout session. */
  create(input: CreateCheckoutSessionInput, options?: RequestOptions): Promise<CheckoutSession> {
    return this.http.post<CheckoutSession>("/v1/checkout-sessions", input, options);
  }

  /** Retrieve a checkout session by id. */
  retrieve(id: string, options?: RequestOptions): Promise<CheckoutSession> {
    return this.http.get<CheckoutSession>(
      `/v1/checkout-sessions/${encodeURIComponent(id)}`,
      options,
    );
  }

  /** Merge buyer-supplied delivery fields into an open session. */
  collectFields(
    id: string,
    fields: Record<string, string>,
    options?: RequestOptions,
  ): Promise<CheckoutSession> {
    return this.http.post<CheckoutSession>(
      `/v1/checkout-sessions/${encodeURIComponent(id)}/collect-fields`,
      { fields },
      options,
    );
  }

  /** Cancel an open checkout session. */
  cancel(id: string, options?: RequestOptions): Promise<CheckoutSession> {
    return this.http.post<CheckoutSession>(
      `/v1/checkout-sessions/${encodeURIComponent(id)}/cancel`,
      undefined,
      options,
    );
  }

  /** Expire an open checkout session. */
  expire(id: string, options?: RequestOptions): Promise<CheckoutSession> {
    return this.http.post<CheckoutSession>(
      `/v1/checkout-sessions/${encodeURIComponent(id)}/expire`,
      undefined,
      options,
    );
  }
}
