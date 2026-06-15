import type { MarketplaceListing } from "@settlekit/common";

/**
 * Persistence boundary for the marketplace domain.
 *
 * Production code wires this to the real database package; tests construct the
 * in-memory implementation below to drive pure domain logic. This is a real
 * interface of OUR storage contract, not a fake of external product behaviour.
 */
export interface ListingStore {
  save(listing: MarketplaceListing): Promise<MarketplaceListing>;
  findById(id: string): Promise<MarketplaceListing | null>;
  listByMerchant(merchantId: string): Promise<MarketplaceListing[]>;
  listByOrganization(organizationId: string): Promise<MarketplaceListing[]>;
  /** All listings (used by discovery/search which filters by published). */
  listAll(): Promise<MarketplaceListing[]>;
}

/** Immutable clone so callers can never mutate stored state by reference. */
function clone(listing: MarketplaceListing): MarketplaceListing {
  return JSON.parse(JSON.stringify(listing)) as MarketplaceListing;
}

/**
 * In-memory {@link ListingStore}. Insertion order is preserved so that, all
 * else equal, listing order is stable and deterministic for tests.
 */
export class InMemoryListingStore implements ListingStore {
  private readonly listings = new Map<string, MarketplaceListing>();

  async save(listing: MarketplaceListing): Promise<MarketplaceListing> {
    this.listings.set(listing.id, clone(listing));
    return clone(listing);
  }

  async findById(id: string): Promise<MarketplaceListing | null> {
    const found = this.listings.get(id);
    return found ? clone(found) : null;
  }

  async listByMerchant(merchantId: string): Promise<MarketplaceListing[]> {
    return [...this.listings.values()]
      .filter((l) => l.merchantId === merchantId)
      .map(clone);
  }

  async listByOrganization(
    organizationId: string,
  ): Promise<MarketplaceListing[]> {
    return [...this.listings.values()]
      .filter((l) => l.organizationId === organizationId)
      .map(clone);
  }

  async listAll(): Promise<MarketplaceListing[]> {
    return [...this.listings.values()].map(clone);
  }
}
