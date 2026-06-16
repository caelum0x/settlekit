import "server-only";

import type { AgentService, MarketplaceListing } from "@settlekit/common";
import {
  generateAgentMetadata,
  type AgentReadableMetadata,
} from "@settlekit/agent-services";
import { getData, type DataLayer } from "@/lib/data";
import type { AgentServiceDTO, ListingDTO, SellerDTO } from "@/lib/types";

/**
 * Repository over the seeded data layer. Translates domain objects from
 * `@settlekit/marketplace-core` / `@settlekit/agent-services` into the wire
 * DTOs the API and pages consume. Pure read model — all writes happen in the
 * seed/data layer.
 */

export interface ListingSearchParams {
  query?: string;
  tags?: string[];
  sort?: "top" | "new" | "price";
}

export interface AgentSearchParams {
  text?: string;
  network?: "arc" | "base";
  maxPrice?: string;
  minPrice?: string;
}

async function listingToDTO(
  data: DataLayer,
  listing: MarketplaceListing,
): Promise<ListingDTO> {
  const merchant = await data.merchantById(listing.merchantId);
  return {
    id: listing.id,
    organizationId: listing.organizationId,
    merchantId: listing.merchantId,
    merchantSlug: merchant?.slug ?? "unknown",
    merchantName: merchant?.displayName ?? "Unknown Seller",
    ...(listing.productId ? { productId: listing.productId } : {}),
    ...(listing.agentServiceId
      ? { agentServiceId: listing.agentServiceId }
      : {}),
    title: listing.title,
    summary: listing.summary,
    tags: listing.tags,
    priceUsdc: await data.listingPriceUsdc(listing),
    ratingAverage: listing.ratingAverage,
    ratingCount: listing.ratingCount,
    createdAt: listing.createdAt,
  };
}

async function agentToDTO(
  data: DataLayer,
  service: AgentService,
): Promise<AgentServiceDTO> {
  const merchant = await data.merchantById(service.merchantId);
  const reputation = await data.agents.getReputation(service.id);
  return {
    id: service.id,
    merchantId: service.merchantId,
    merchantSlug: merchant?.slug ?? "unknown",
    merchantName: merchant?.displayName ?? "Unknown Seller",
    productId: service.productId,
    name: service.name,
    description: service.description,
    endpoint: service.endpoint,
    price: service.price,
    currency: service.currency,
    paymentProtocol: service.paymentProtocol,
    network: service.network,
    inputSchema: service.inputSchema,
    ...(service.outputSchema ? { outputSchema: service.outputSchema } : {}),
    ratingAverage: round2(reputation.ratingAverage),
    ratingCount: reputation.ratingCount,
    createdAt: service.createdAt,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Search published marketplace listings. */
export async function searchListings(
  params: ListingSearchParams = {},
): Promise<ListingDTO[]> {
  const data = await getData();
  const results = await data.marketplace.search({
    ...(params.query ? { query: params.query } : {}),
    ...(params.tags && params.tags.length > 0 ? { tags: params.tags } : {}),
    sort: params.sort ?? "top",
  });
  return Promise.all(results.map((listing) => listingToDTO(data, listing)));
}

/** The distinct set of tags across all published listings, sorted. */
export async function allListingTags(): Promise<string[]> {
  const listings = await searchListings();
  const tags = new Set<string>();
  for (const listing of listings) {
    for (const tag of listing.tags) tags.add(tag);
  }
  return [...tags].sort();
}

/** Fetch a single listing DTO by id, or null. */
export async function getListing(id: string): Promise<ListingDTO | null> {
  const data = await getData();
  const listing = await data.marketplace.getListing(id);
  if (listing === null || !listing.published) return null;
  return listingToDTO(data, listing);
}


/** Discover published agent services. */
export async function searchAgentServices(
  params: AgentSearchParams = {},
): Promise<AgentServiceDTO[]> {
  const data = await getData();
  const services = await data.agents.discover({
    publishedOnly: true,
    ...(params.text ? { text: params.text } : {}),
    ...(params.network ? { network: params.network } : {}),
    ...(params.maxPrice ? { maxPrice: params.maxPrice } : {}),
    ...(params.minPrice ? { minPrice: params.minPrice } : {}),
  });
  return Promise.all(services.map((service) => agentToDTO(data, service)));
}

/** Fetch a single agent service DTO by id, or null. */
export async function getAgentService(
  id: string,
): Promise<AgentServiceDTO | null> {
  const data = await getData();
  const found = await data.agents.get(id);
  if (found.ok === false || !found.value.published) return null;
  return agentToDTO(data, found.value);
}

/** The plan §11 agent-readable metadata for a service, or null. */
export async function getAgentMetadata(
  id: string,
): Promise<AgentReadableMetadata | null> {
  const data = await getData();
  const found = await data.agents.get(id);
  if (found.ok === false || !found.value.published) return null;
  return generateAgentMetadata(found.value);
}

/** Build the public seller profile for a merchant slug, or null. */
export async function getSeller(slug: string): Promise<SellerDTO | null> {
  const data = await getData();
  const merchant = await data.merchantBySlug(slug);
  if (!merchant) return null;

  const profile = await data.marketplace.sellerProfile(merchant.id);

  const allListings = await searchListings({ sort: "new" });
  const listings = allListings.filter((l) => l.merchantId === merchant.id);

  const allAgents = await searchAgentServices();
  const agentServices = allAgents.filter((a) => a.merchantId === merchant.id);

  return {
    id: merchant.id,
    slug: merchant.slug,
    displayName: merchant.displayName,
    bio: merchant.bio,
    ...(merchant.supportEmail ? { supportEmail: merchant.supportEmail } : {}),
    ...(merchant.websiteUrl ? { websiteUrl: merchant.websiteUrl } : {}),
    totalListings: profile.totalListings,
    publishedListings: profile.publishedListings,
    totalRatings: profile.totalRatings,
    ratingAverage: profile.ratingAverage,
    listings,
    agentServices,
  };
}

/** All seller slugs (used for static params / directory linking). */
export async function allSellerSlugs(): Promise<string[]> {
  const data = await getData();
  return data.allSellerSlugs();
}
