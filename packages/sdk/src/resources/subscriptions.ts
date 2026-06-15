/**
 * Subscriptions resource client. Maps to `/v1/subscriptions`.
 *
 * Creating a subscription also grants a subscription entitlement for the
 * product; both are returned together.
 */
import type { Subscription, Entitlement } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link SubscriptionsResource.create}. */
export interface CreateSubscriptionInput {
  organizationId: string;
  customerId: string;
  productId: string;
  priceId: string;
  cancelAtPeriodEnd?: boolean;
}

/** Result of creating a subscription. */
export interface CreateSubscriptionResult {
  subscription: Subscription;
  entitlement: Entitlement;
}

/** Client for subscription endpoints. */
export class SubscriptionsResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a subscription from a recurring price. */
  create(input: CreateSubscriptionInput, options?: RequestOptions): Promise<CreateSubscriptionResult> {
    return this.http.post<CreateSubscriptionResult>("/v1/subscriptions", input, options);
  }

  /** Retrieve a subscription by id. */
  retrieve(id: string, options?: RequestOptions): Promise<Subscription> {
    return this.http.get<Subscription>(`/v1/subscriptions/${encodeURIComponent(id)}`, options);
  }

  /** Renew a subscription for another period. */
  renew(id: string, options?: RequestOptions): Promise<Subscription> {
    return this.http.post<Subscription>(`/v1/subscriptions/${encodeURIComponent(id)}/renew`, undefined, options);
  }

  /** Cancel a subscription. */
  cancel(id: string, options?: RequestOptions): Promise<Subscription> {
    return this.http.post<Subscription>(`/v1/subscriptions/${encodeURIComponent(id)}/cancel`, undefined, options);
  }
}
