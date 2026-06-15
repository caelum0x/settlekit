/**
 * Delivery runs + delivery action testing resource client.
 *
 * Maps to `/v1/delivery-runs` and `/v1/delivery-actions/test`.
 */
import type { DeliveryRun, DeliveryAction } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Query options for {@link DeliveryRunsResource.list}. */
export interface ListDeliveryRunsParams {
  organizationId?: string;
  paymentId?: string;
}

/** Input for {@link DeliveryRunsResource.test}. */
export interface TestDeliveryActionInput {
  organizationId?: string;
  customerId?: string;
  productId?: string;
  paymentId?: string;
  entitlementId?: string;
  customerEmail?: string;
  githubInstallationId?: number;
  githubUsername?: string;
  discordUserId?: string;
  action: DeliveryAction;
}

/** Result of executing a single delivery action through the handler registry. */
export interface TestDeliveryActionResult {
  action: DeliveryAction;
  status: string;
  output: unknown;
}

/** Client for delivery run + delivery action endpoints. */
export class DeliveryRunsResource {
  constructor(private readonly http: HttpClient) {}

  /** List delivery runs, optionally filtered by org / payment. */
  list(params: ListDeliveryRunsParams = {}, options?: RequestOptions): Promise<DeliveryRun[]> {
    return this.http.get<DeliveryRun[]>("/v1/delivery-runs", {
      ...options,
      query: {
        ...(params.organizationId !== undefined ? { organizationId: params.organizationId } : {}),
        ...(params.paymentId !== undefined ? { paymentId: params.paymentId } : {}),
      },
    });
  }

  /** Retrieve a delivery run by id. */
  retrieve(id: string, options?: RequestOptions): Promise<DeliveryRun> {
    return this.http.get<DeliveryRun>(`/v1/delivery-runs/${encodeURIComponent(id)}`, options);
  }

  /** Retry the failed actions of a delivery run. */
  retry(id: string, options?: RequestOptions): Promise<DeliveryRun> {
    return this.http.post<DeliveryRun>(`/v1/delivery-runs/${encodeURIComponent(id)}/retry`, undefined, options);
  }

  /** Execute a single delivery action through the real handler registry. */
  test(input: TestDeliveryActionInput, options?: RequestOptions): Promise<TestDeliveryActionResult> {
    return this.http.post<TestDeliveryActionResult>("/v1/delivery-actions/test", input, options);
  }
}
