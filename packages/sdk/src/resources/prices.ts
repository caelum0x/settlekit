/**
 * Prices resource client.
 *
 * Prices in the API are nested under a product (`/v1/products/:id/prices`).
 * This client wraps those nested endpoints so callers can work with prices
 * without reaching into the products client.
 */
import type { Price } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";
import type { CreatePriceInput } from "./products.js";

/** Client for price endpoints (nested under products). */
export class PricesResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a price for a product. */
  create(productId: string, input: CreatePriceInput, options?: RequestOptions): Promise<Price> {
    return this.http.post<Price>(
      `/v1/products/${encodeURIComponent(productId)}/prices`,
      input,
      options,
    );
  }

  /** List the prices attached to a product. */
  listForProduct(productId: string, options?: RequestOptions): Promise<Price[]> {
    return this.http.get<Price[]>(
      `/v1/products/${encodeURIComponent(productId)}/prices`,
      options,
    );
  }
}
