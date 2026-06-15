/**
 * Postgres-backed {@link ListingStore} (@settlekit/marketplace-core) over the
 * shared `marketplace_listings` table. The canonical {@link MarketplaceListing}
 * lives in `metadata.__doc`; typed columns are projected for discovery queries.
 * A stable, unique `slug` is derived from the listing title + id suffix.
 */
import { eq, packDoc, unpackDoc, unpackDocs, type Database, marketplaceListings } from "@settlekit/database";
import type { MarketplaceListing } from "@settlekit/common";
import type { ListingStore } from "@settlekit/marketplace-core";

/** Build a stable, unique slug for a listing (title + last 8 of its id). */
function slugFor(listing: MarketplaceListing): string {
  const base =
    listing.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "listing";
  return `${base}-${listing.id.slice(-8)}`;
}

export class PgMarketplaceListingStore implements ListingStore {
  constructor(private readonly db: Database) {}

  async save(listing: MarketplaceListing): Promise<MarketplaceListing> {
    const projection = {
      merchantId: listing.merchantId,
      // Product listings always carry a productId; the FK references a real
      // product the merchant published.
      productId: listing.productId ?? listing.id,
      slug: slugFor(listing),
      title: listing.title,
      summary: listing.summary,
      tags: listing.tags,
      status: listing.published ? "published" : "draft",
      publishedAt: listing.published ? new Date() : null,
      metadata: packDoc(listing),
    };
    await this.db
      .insert(marketplaceListings)
      .values({ id: listing.id, ...projection })
      .onConflictDoUpdate({ target: marketplaceListings.id, set: projection });
    return listing;
  }

  async findById(id: string): Promise<MarketplaceListing | null> {
    const rows = await this.db
      .select({ metadata: marketplaceListings.metadata })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.id, id))
      .limit(1);
    return unpackDoc<MarketplaceListing>(rows[0]);
  }

  async listByMerchant(merchantId: string): Promise<MarketplaceListing[]> {
    const rows = await this.db
      .select({ metadata: marketplaceListings.metadata })
      .from(marketplaceListings)
      .where(eq(marketplaceListings.merchantId, merchantId));
    return unpackDocs<MarketplaceListing>(rows);
  }

  async listByOrganization(organizationId: string): Promise<MarketplaceListing[]> {
    // No organization column on the table; filter the unpacked documents.
    const rows = await this.db.select({ metadata: marketplaceListings.metadata }).from(marketplaceListings);
    return unpackDocs<MarketplaceListing>(rows).filter((l) => l.organizationId === organizationId);
  }

  async listAll(): Promise<MarketplaceListing[]> {
    const rows = await this.db.select({ metadata: marketplaceListings.metadata }).from(marketplaceListings);
    return unpackDocs<MarketplaceListing>(rows);
  }
}
