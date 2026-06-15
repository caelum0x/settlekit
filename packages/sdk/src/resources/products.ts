/**
 * Products + prices resource client.
 *
 * Maps to `/v1/products` (and nested `/v1/products/:id/prices`).
 */
import type { Product, Price, ProductType, DeliveryMode } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link ProductsResource.create}. */
export interface CreateProductInput {
  merchantId: string;
  organizationId: string;
  name: string;
  description?: string;
  type: ProductType;
  deliveryMode: DeliveryMode;
  metadata?: Record<string, unknown>;
}

/** Input for {@link ProductsResource.createPrice}. */
export interface CreatePriceInput {
  amount: string;
  currency?: "USDC";
  interval?: "one_time" | "monthly" | "yearly";
  usageBased?: boolean;
  unitAmount?: string;
  creditsGranted?: number;
}

/** Client for product + price endpoints. */
export class ProductsResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a product draft. */
  create(input: CreateProductInput, options?: RequestOptions): Promise<Product> {
    return this.http.post<Product>("/v1/products", input, options);
  }

  /** List all products. */
  list(options?: RequestOptions): Promise<Product[]> {
    return this.http.get<Product[]>("/v1/products", options);
  }

  /** Retrieve a single product by id. */
  retrieve(id: string, options?: RequestOptions): Promise<Product> {
    return this.http.get<Product>(`/v1/products/${encodeURIComponent(id)}`, options);
  }

  /** Publish a product (requires at least one active price). */
  publish(id: string, options?: RequestOptions): Promise<Product> {
    return this.http.post<Product>(`/v1/products/${encodeURIComponent(id)}/publish`, undefined, options);
  }

  /** Create a price attached to a product. */
  createPrice(productId: string, input: CreatePriceInput, options?: RequestOptions): Promise<Price> {
    return this.http.post<Price>(
      `/v1/products/${encodeURIComponent(productId)}/prices`,
      input,
      options,
    );
  }

  /** List prices for a product. */
  listPrices(productId: string, options?: RequestOptions): Promise<Price[]> {
    return this.http.get<Price[]>(
      `/v1/products/${encodeURIComponent(productId)}/prices`,
      options,
    );
  }
}
