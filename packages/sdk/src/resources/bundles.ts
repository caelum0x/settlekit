/**
 * Bundles resource client. Maps to `/v1/bundles`.
 */
import type { Bundle } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link BundlesResource.create}. */
export interface CreateBundleInput {
  merchantId: string;
  organizationId: string;
  name: string;
  description?: string;
  productIds: string[];
  amount?: string;
  interval?: "one_time" | "monthly" | "yearly";
}

/** Input for {@link BundlesResource.update}. */
export interface UpdateBundleInput {
  name?: string;
  description?: string;
  status?: "draft" | "active" | "archived";
}

/** Query options for {@link BundlesResource.list}. */
export interface ListBundlesParams {
  organizationId?: string;
}

/** Client for bundle endpoints. */
export class BundlesResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a bundle from a set of product ids. */
  create(input: CreateBundleInput, options?: RequestOptions): Promise<Bundle> {
    return this.http.post<Bundle>("/v1/bundles", input, options);
  }

  /** List bundles, optionally filtered by organization. */
  list(params: ListBundlesParams = {}, options?: RequestOptions): Promise<Bundle[]> {
    return this.http.get<Bundle[]>("/v1/bundles", {
      ...options,
      query: { ...(params.organizationId !== undefined ? { organizationId: params.organizationId } : {}) },
    });
  }

  /** Retrieve a bundle by id. */
  retrieve(id: string, options?: RequestOptions): Promise<Bundle> {
    return this.http.get<Bundle>(`/v1/bundles/${encodeURIComponent(id)}`, options);
  }

  /** Patch mutable bundle fields. */
  update(id: string, input: UpdateBundleInput, options?: RequestOptions): Promise<Bundle> {
    return this.http.patch<Bundle>(`/v1/bundles/${encodeURIComponent(id)}`, input, options);
  }

  /** Publish a bundle (sets status to active). */
  publish(id: string, options?: RequestOptions): Promise<Bundle> {
    return this.http.post<Bundle>(`/v1/bundles/${encodeURIComponent(id)}/publish`, undefined, options);
  }
}
