import type { MarketplaceListing } from "@settlekit/common";

/**
 * Aggregate reputation and inventory view for a single merchant, derived from
 * their marketplace listings.
 */
export interface SellerProfile {
  merchantId: string;
  totalListings: number;
  publishedListings: number;
  /** Sum of rating counts across all of the merchant's listings. */
  totalRatings: number;
  /**
   * Rating-count-weighted average across listings. A listing with more ratings
   * contributes proportionally more to the seller's overall score.
   */
  ratingAverage: number;
  /** IDs of the merchant's listings, newest first. */
  listingIds: string[];
}

function roundAverage(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Build a {@link SellerProfile} for a merchant from a set of listings. Listings
 * belonging to other merchants are ignored, so callers may pass a broad set.
 */
export function sellerProfile(
  merchantId: string,
  listings: readonly MarketplaceListing[],
): SellerProfile {
  const owned = listings
    .filter((l) => l.merchantId === merchantId)
    .slice()
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0));

  let publishedListings = 0;
  let totalRatings = 0;
  let weightedSum = 0;

  for (const listing of owned) {
    if (listing.published) publishedListings += 1;
    totalRatings += listing.ratingCount;
    weightedSum += listing.ratingAverage * listing.ratingCount;
  }

  const ratingAverage =
    totalRatings === 0 ? 0 : roundAverage(weightedSum / totalRatings);

  return {
    merchantId,
    totalListings: owned.length,
    publishedListings,
    totalRatings,
    ratingAverage,
    listingIds: owned.map((l) => l.id),
  };
}
