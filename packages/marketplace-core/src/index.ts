import { generateId, type MarketplaceListing } from "@settlekit/common";

export function createMarketplaceListing(input: Omit<MarketplaceListing, "id" | "ratingAverage" | "ratingCount" | "createdAt">, now = new Date()): MarketplaceListing {
  return {
    ...input,
    id: generateId("marketplaceListing"),
    ratingAverage: 0,
    ratingCount: 0,
    createdAt: now.toISOString(),
  };
}

export function listingIsDiscoverable(listing: MarketplaceListing): boolean {
  return listing.published && (listing.productId !== undefined || listing.agentServiceId !== undefined);
}
