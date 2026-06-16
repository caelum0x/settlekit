/**
 * Marketplace resource client — public product listings + discovery.
 *
 * Maps to `/v1/marketplace`.
 */
import type { MarketplaceListing } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link MarketplaceResource.createListing}. */
export interface CreateListingInput {
  organizationId: string;
  merchantId: string;
  productId: string;
  title: string;
  summary: string;
  tags?: string[];
}

/** Discovery query for {@link MarketplaceResource.search}. */
export interface ListingSearch {
  query?: string;
  tag?: string;
  sort?: "top" | "new" | "price";
}

/** Aggregate reputation/inventory view of a seller. */
export interface SellerProfile {
  merchantId: string;
  totalListings: number;
  publishedListings: number;
  totalRatings: number;
  ratingAverage: number;
  listingIds: string[];
}

/** Client for marketplace endpoints. */
export class MarketplaceResource {
  constructor(private readonly http: HttpClient) {}

  /** Create an (unpublished) listing for a product. */
  createListing(input: CreateListingInput, options?: RequestOptions): Promise<MarketplaceListing> {
    return this.http.post<MarketplaceListing>("/v1/marketplace/listings", input, options);
  }

  /** Search published listings. */
  search(query: ListingSearch = {}, options?: RequestOptions): Promise<MarketplaceListing[]> {
    const params = new URLSearchParams();
    if (query.query) params.set("q", query.query);
    if (query.tag) params.set("tag", query.tag);
    if (query.sort) params.set("sort", query.sort);
    const qs = params.toString();
    return this.http.get<MarketplaceListing[]>(`/v1/marketplace/listings${qs ? `?${qs}` : ""}`, options);
  }

  /** Retrieve a listing by id. */
  retrieve(id: string, options?: RequestOptions): Promise<MarketplaceListing> {
    return this.http.get<MarketplaceListing>(`/v1/marketplace/listings/${encodeURIComponent(id)}`, options);
  }

  /** Publish a listing (make it discoverable). */
  publish(id: string, options?: RequestOptions): Promise<MarketplaceListing> {
    return this.http.post<MarketplaceListing>(`/v1/marketplace/listings/${encodeURIComponent(id)}/publish`, undefined, options);
  }

  /** Remove a listing from discovery. */
  unpublish(id: string, options?: RequestOptions): Promise<MarketplaceListing> {
    return this.http.post<MarketplaceListing>(`/v1/marketplace/listings/${encodeURIComponent(id)}/unpublish`, undefined, options);
  }

  /** Add a 1–5 star rating to a listing. */
  rate(id: string, stars: number, options?: RequestOptions): Promise<MarketplaceListing> {
    return this.http.post<MarketplaceListing>(`/v1/marketplace/listings/${encodeURIComponent(id)}/rate`, { stars }, options);
  }

  /** Fetch a seller's aggregate profile. */
  seller(merchantId: string, options?: RequestOptions): Promise<SellerProfile> {
    return this.http.get<SellerProfile>(`/v1/marketplace/sellers/${encodeURIComponent(merchantId)}`, options);
  }
}
