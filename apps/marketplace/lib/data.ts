import "server-only";

import {
  MarketplaceService,
  InMemoryListingStore,
  type PriceResolver,
} from "@settlekit/marketplace-core";
import {
  AgentServiceService,
  InMemoryAgentServiceStore,
  InMemoryAgentUsageStore,
  InMemoryAgentReputationStore,
} from "@settlekit/agent-services";
import { toBaseUnits, type MarketplaceListing } from "@settlekit/common";
import { createDb, merchants, eq } from "@settlekit/database";
import {
  PgMarketplaceListingStore,
  PgAgentServiceStore,
  PgAgentUsageStore,
  PgAgentReputationStore,
  PgPriceStore,
} from "@settlekit/persistence";
import {
  SEED_AGENT_SERVICES,
  SEED_LISTINGS,
  SEED_MERCHANTS,
} from "@/lib/seed";

/**
 * Server-side data layer for the marketplace.
 *
 * When `DATABASE_URL` is set the marketplace serves the REAL listings + agent
 * services merchants published (via the API's `/v1/marketplace/*` and
 * `/v1/agent-services` routes), reading live from the shared Postgres tables
 * through `@settlekit/persistence`. With no database it falls back to the
 * in-process seed catalog so the app runs standalone for local dev.
 *
 * Listing prices and merchant profiles are resolved LIVE (async) rather than
 * snapshotted into Maps, so newly published data appears without a restart.
 */

/** Minimal merchant view the marketplace pages render. */
export interface MerchantInfo {
  id: string;
  organizationId: string;
  slug: string;
  displayName: string;
  bio: string;
  supportEmail?: string;
  websiteUrl?: string;
}

export interface DataLayer {
  marketplace: MarketplaceService;
  agents: AgentServiceService;
  /** Display price (major-unit USDC) for a listing's product, or "0.00". */
  listingPriceUsdc(listing: MarketplaceListing): Promise<string>;
  merchantById(id: string): Promise<MerchantInfo | undefined>;
  merchantBySlug(slug: string): Promise<MerchantInfo | undefined>;
  allSellerSlugs(): Promise<string[]>;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let cached: Promise<DataLayer> | null = null;

/** Lazily build (once) and return the data layer for the active backend. */
export function getData(): Promise<DataLayer> {
  if (cached === null) {
    const url = process.env.DATABASE_URL?.trim();
    cached = url ? buildPostgres(url) : buildSeed();
  }
  return cached;
}

/** Resolve the first price (major-unit string) for a product id. */
async function firstProductPrice(prices: PgPriceStore, productId?: string): Promise<string | undefined> {
  if (!productId) return undefined;
  const list = await prices.list((p) => p.productId === productId);
  return list[0]?.amount;
}

// --- Postgres backend ---------------------------------------------------

async function buildPostgres(databaseUrl: string): Promise<DataLayer> {
  const db = createDb(databaseUrl);
  const prices = new PgPriceStore(db);

  const priceResolver: PriceResolver = {
    async priceBaseUnits(listing) {
      const price = await firstProductPrice(prices, listing.productId);
      return price === undefined ? undefined : toBaseUnits(price);
    },
  };

  const marketplace = new MarketplaceService(new PgMarketplaceListingStore(db), priceResolver);
  const agents = new AgentServiceService({
    services: new PgAgentServiceStore(db),
    usage: new PgAgentUsageStore(db),
    reputation: new PgAgentReputationStore(db),
  });

  function toMerchant(row: { id: string; displayName: string; metadata: Record<string, unknown> | null }): MerchantInfo {
    const meta = row.metadata ?? {};
    return {
      id: row.id,
      organizationId: typeof meta.organizationId === "string" ? meta.organizationId : "",
      slug: typeof meta.slug === "string" ? meta.slug : slugify(row.displayName),
      displayName: row.displayName,
      bio: typeof meta.bio === "string" ? meta.bio : "",
      ...(typeof meta.supportEmail === "string" ? { supportEmail: meta.supportEmail } : {}),
      ...(typeof meta.websiteUrl === "string" ? { websiteUrl: meta.websiteUrl } : {}),
    };
  }

  const merchantCols = { id: merchants.id, displayName: merchants.displayName, metadata: merchants.metadata };

  return {
    marketplace,
    agents,
    async listingPriceUsdc(listing) {
      return (await firstProductPrice(prices, listing.productId)) ?? "0.00";
    },
    async merchantById(id) {
      const rows = await db.select(merchantCols).from(merchants).where(eq(merchants.id, id)).limit(1);
      return rows[0] ? toMerchant(rows[0]) : undefined;
    },
    async merchantBySlug(slug) {
      const rows = await db.select(merchantCols).from(merchants);
      return rows.map(toMerchant).find((m) => m.slug === slug);
    },
    async allSellerSlugs() {
      const rows = await db.select(merchantCols).from(merchants);
      return rows.map(toMerchant).map((m) => m.slug);
    },
  };
}

// --- Seed backend -------------------------------------------------------

async function buildSeed(): Promise<DataLayer> {
  const listingPrices = new Map<string, string>();
  const merchantsBySlug = new Map<string, MerchantInfo>();
  const merchantsById = new Map<string, MerchantInfo>();

  for (const m of SEED_MERCHANTS) {
    const info: MerchantInfo = {
      id: m.id,
      organizationId: m.organizationId,
      slug: m.slug,
      displayName: m.displayName,
      bio: m.bio,
      ...(m.supportEmail ? { supportEmail: m.supportEmail } : {}),
      ...(m.websiteUrl ? { websiteUrl: m.websiteUrl } : {}),
    };
    merchantsBySlug.set(m.slug, info);
    merchantsById.set(m.id, info);
  }

  const marketplace = new MarketplaceService(new InMemoryListingStore(), {
    async priceBaseUnits(listing: MarketplaceListing) {
      const p = listingPrices.get(listing.id);
      return p === undefined ? undefined : toBaseUnits(p);
    },
  });

  const agents = new AgentServiceService({
    services: new InMemoryAgentServiceStore(),
    usage: new InMemoryAgentUsageStore(),
    reputation: new InMemoryAgentReputationStore(),
  });

  for (const seed of SEED_AGENT_SERVICES) {
    const merchant = merchantsBySlug.get(seed.merchantSlug);
    if (!merchant) continue;
    const created = await agents.create({
      organizationId: merchant.organizationId,
      merchantId: merchant.id,
      productId: `prod_${merchant.id}_${slugify(seed.name)}`,
      name: seed.name,
      description: seed.description,
      endpoint: seed.endpoint,
      price: seed.price,
      network: seed.network,
      inputSchema: seed.inputSchema,
      ...(seed.outputSchema ? { outputSchema: seed.outputSchema } : {}),
    });
    if (created.ok === false) continue;
    await agents.publish(created.value.id);
    for (const stars of seed.ratings) await agents.rate(created.value.id, stars);
  }

  for (const seed of SEED_LISTINGS) {
    const merchant = merchantsBySlug.get(seed.merchantSlug);
    if (!merchant) continue;
    const listing = await marketplace.createListing(
      {
        organizationId: merchant.organizationId,
        merchantId: merchant.id,
        productId: `prod_${merchant.id}_${slugify(seed.title)}`,
        title: seed.title,
        summary: seed.summary,
        tags: seed.tags,
      },
      new Date(seed.createdAt),
    );
    listingPrices.set(listing.id, seed.priceUsdc);
    await marketplace.publish(listing.id);
    for (const stars of seed.ratings) await marketplace.addRating(listing.id, stars);
  }

  return {
    marketplace,
    agents,
    async listingPriceUsdc(listing) {
      return listingPrices.get(listing.id) ?? "0.00";
    },
    async merchantById(id) {
      return merchantsById.get(id);
    },
    async merchantBySlug(slug) {
      return merchantsBySlug.get(slug);
    },
    async allSellerSlugs() {
      return [...merchantsBySlug.keys()];
    },
  };
}
