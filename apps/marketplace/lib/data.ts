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
import {
  SEED_AGENT_SERVICES,
  SEED_LISTINGS,
  SEED_MERCHANTS,
  type SeedMerchant,
} from "@/lib/seed";

/**
 * In-process data layer for the marketplace app. It wires the REAL
 * `@settlekit/marketplace-core` and `@settlekit/agent-services` services over
 * their in-memory stores, then seeds them with concrete domain records.
 *
 * The seeded store maps a listing id -> the seed's USDC price so price sorting
 * and price display work against live data. This is the source the local API
 * routes read from when no external API_URL is reachable.
 */

export interface DataLayer {
  marketplace: MarketplaceService;
  agents: AgentServiceService;
  /** listingId -> per-unit USDC price (major units). */
  listingPrices: Map<string, string>;
  /** agentServiceId -> per-call USDC price (major units). */
  agentPrices: Map<string, string>;
  merchantsBySlug: Map<string, SeedMerchant>;
  merchantsById: Map<string, SeedMerchant>;
}

let cached: Promise<DataLayer> | null = null;

function priceResolver(prices: Map<string, string>): PriceResolver {
  return {
    async priceBaseUnits(
      listing: MarketplaceListing,
    ): Promise<bigint | undefined> {
      const price = prices.get(listing.id);
      return price === undefined ? undefined : toBaseUnits(price);
    },
  };
}

async function build(): Promise<DataLayer> {
  const listingPrices = new Map<string, string>();
  const agentPrices = new Map<string, string>();

  const merchantsBySlug = new Map<string, SeedMerchant>();
  const merchantsById = new Map<string, SeedMerchant>();
  for (const merchant of SEED_MERCHANTS) {
    merchantsBySlug.set(merchant.slug, merchant);
    merchantsById.set(merchant.id, merchant);
  }

  const marketplace = new MarketplaceService(
    new InMemoryListingStore(),
    priceResolver(listingPrices),
  );

  const agents = new AgentServiceService({
    services: new InMemoryAgentServiceStore(),
    usage: new InMemoryAgentUsageStore(),
    reputation: new InMemoryAgentReputationStore(),
  });

  // Seed agent services first.
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
    const service = created.value;
    await agents.publish(service.id);
    agentPrices.set(service.id, service.price);
    for (const stars of seed.ratings) {
      await agents.rate(service.id, stars);
    }
  }

  // Seed marketplace product listings.
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
    for (const stars of seed.ratings) {
      await marketplace.addRating(listing.id, stars);
    }
  }

  return {
    marketplace,
    agents,
    listingPrices,
    agentPrices,
    merchantsBySlug,
    merchantsById,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Lazily build (once) and return the seeded data layer. */
export function getData(): Promise<DataLayer> {
  if (cached === null) {
    cached = build();
  }
  return cached;
}
