import { notFound, type MarketplaceListing, type Money } from "@settlekit/common";
import { createListing, publishListing, unpublishListing } from "./listing.js";
import type { CreateListingInput } from "./listing.js";
import {
  searchListings,
  type ListingWithContext,
  type SearchQuery,
} from "./search.js";
import { addRating } from "./ratings.js";
import { sellerProfile, type SellerProfile } from "./seller-profile.js";
import { marketplaceFee, splitFee, type FeeSplit } from "./fees.js";
import type { ListingStore } from "./store.js";

/**
 * Resolves the current price (in integer base units) for a listing's
 * underlying sellable, enabling price-sorted search. Production wires this to
 * the pricing/product packages; tests can supply a real in-memory lookup.
 */
export interface PriceResolver {
  priceBaseUnits(listing: MarketplaceListing): Promise<bigint | undefined>;
}

/** A price resolver that reports no price for any listing. */
export const noPriceResolver: PriceResolver = {
  async priceBaseUnits(): Promise<bigint | undefined> {
    return undefined;
  },
};

/**
 * Application service coordinating marketplace discovery over a
 * {@link ListingStore}. All mutations are immutable: the service reads, applies
 * a pure domain transform, then persists the new value.
 */
export class MarketplaceService {
  constructor(
    private readonly store: ListingStore,
    private readonly priceResolver: PriceResolver = noPriceResolver,
  ) {}

  /** Create and persist a new (unpublished) listing. */
  async createListing(
    input: CreateListingInput,
    now: Date = new Date(),
  ): Promise<MarketplaceListing> {
    const listing = createListing(input, now);
    return this.store.save(listing);
  }

  async getListing(id: string): Promise<MarketplaceListing | null> {
    return this.store.findById(id);
  }

  private async requireListing(id: string): Promise<MarketplaceListing> {
    const listing = await this.store.findById(id);
    if (!listing) {
      throw notFound("Marketplace listing not found", { id });
    }
    return listing;
  }

  /** Publish a listing, making it discoverable via search. */
  async publish(id: string): Promise<MarketplaceListing> {
    const listing = await this.requireListing(id);
    return this.store.save(publishListing(listing));
  }

  /** Unpublish a listing, removing it from discovery. */
  async unpublish(id: string): Promise<MarketplaceListing> {
    const listing = await this.requireListing(id);
    return this.store.save(unpublishListing(listing));
  }

  /**
   * Record a 1..5 star rating against a listing and persist the recomputed
   * aggregate. Returns the updated listing.
   */
  async addRating(id: string, stars: number): Promise<MarketplaceListing> {
    const listing = await this.requireListing(id);
    return this.store.save(addRating(listing, stars));
  }

  /**
   * Search published listings. Resolves each candidate's price so that the
   * "price" sort works against live pricing data.
   */
  async search(query: SearchQuery = {}): Promise<MarketplaceListing[]> {
    const all = await this.store.listAll();
    const published = all.filter((l) => l.published);

    const contexts: ListingWithContext[] = await Promise.all(
      published.map(async (listing) => ({
        listing,
        priceBaseUnits:
          query.sort === "price"
            ? await this.priceResolver.priceBaseUnits(listing)
            : undefined,
      })),
    );

    return searchListings(contexts, query);
  }

  /** Aggregate reputation/inventory view for a merchant. */
  async sellerProfile(merchantId: string): Promise<SellerProfile> {
    const listings = await this.store.listByMerchant(merchantId);
    return sellerProfile(merchantId, listings);
  }

  /** Compute the platform fee for a gross amount (plan §32: 5%–15%). */
  marketplaceFee(amount: Money, feeBps: number): Money {
    return marketplaceFee(amount, feeBps);
  }

  /** Split a gross amount into platform fee and seller net payout. */
  splitFee(amount: Money, feeBps: number): FeeSplit {
    return splitFee(amount, feeBps);
  }
}
