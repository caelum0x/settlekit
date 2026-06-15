import "server-only";

import type {
  AgentReadableMetadata,
  AgentServiceDTO,
  ApiResponse,
  ListingDTO,
  SellerDTO,
} from "@/lib/types";
import {
  allListingTags,
  getAgentMetadata,
  getAgentService,
  getListing,
  getSeller,
  searchAgentServices,
  searchListings,
  type AgentSearchParams,
  type ListingSearchParams,
} from "@/lib/repository";

/**
 * Marketplace API client.
 *
 * Primary path: fetch the published REST API at NEXT_PUBLIC_API_URL using the
 * documented `/v1/marketplace/*` and `/v1/agent-services` routes. If that API
 * is unreachable (e.g. running the marketplace app standalone), it transparently
 * falls back to the in-process repository, which is backed by the REAL
 * @settlekit/marketplace-core and @settlekit/agent-services packages over a
 * seeded store. Either way the data is real and search works.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const FETCH_TIMEOUT_MS = 2_500;

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value.length > 0) search.set(key, value);
  }
  const qs = search.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

async function tryRemote<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
      // Always fetch fresh marketplace state; let Next cache at page level.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as ApiResponse<T>;
    if (body.success === false || body.data === null) return null;
    return body.data;
  } catch {
    // Remote API unavailable; caller falls back to the local repository.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ListingQuery {
  q?: string;
  tags?: string[];
  sort?: "top" | "new" | "price";
}

/** List published marketplace listings with search + tag filters. */
export async function fetchListings(
  query: ListingQuery = {},
): Promise<ListingDTO[]> {
  const path = `/v1/marketplace/listings${buildQuery({
    q: query.q,
    tags: query.tags?.join(","),
    sort: query.sort,
  })}`;
  const remote = await tryRemote<ListingDTO[]>(path);
  if (remote !== null) return remote;

  const params: ListingSearchParams = {
    ...(query.q ? { query: query.q } : {}),
    ...(query.tags ? { tags: query.tags } : {}),
    sort: query.sort ?? "top",
  };
  return searchListings(params);
}

/** The available tag facet for the listing filter UI. */
export async function fetchListingTags(): Promise<string[]> {
  const remote = await tryRemote<string[]>("/v1/marketplace/tags");
  if (remote !== null) return remote;
  return allListingTags();
}

/** A single listing by id. */
export async function fetchListing(id: string): Promise<ListingDTO | null> {
  const remote = await tryRemote<ListingDTO>(
    `/v1/marketplace/listings/${encodeURIComponent(id)}`,
  );
  if (remote !== null) return remote;
  return getListing(id);
}

export interface AgentQuery {
  q?: string;
  network?: "arc" | "base";
  maxPrice?: string;
  minPrice?: string;
}

/** Discover published agent services. */
export async function fetchAgentServices(
  query: AgentQuery = {},
): Promise<AgentServiceDTO[]> {
  const path = `/v1/agent-services${buildQuery({
    q: query.q,
    network: query.network,
    maxPrice: query.maxPrice,
    minPrice: query.minPrice,
  })}`;
  const remote = await tryRemote<AgentServiceDTO[]>(path);
  if (remote !== null) return remote;

  const params: AgentSearchParams = {
    ...(query.q ? { text: query.q } : {}),
    ...(query.network ? { network: query.network } : {}),
    ...(query.maxPrice ? { maxPrice: query.maxPrice } : {}),
    ...(query.minPrice ? { minPrice: query.minPrice } : {}),
  };
  return searchAgentServices(params);
}

/** A single agent service by id. */
export async function fetchAgentService(
  id: string,
): Promise<AgentServiceDTO | null> {
  const remote = await tryRemote<AgentServiceDTO>(
    `/v1/agent-services/${encodeURIComponent(id)}`,
  );
  if (remote !== null) return remote;
  return getAgentService(id);
}

/** The plan §11 agent-readable metadata document for a service. */
export async function fetchAgentMetadata(
  id: string,
): Promise<AgentReadableMetadata | null> {
  const remote = await tryRemote<AgentReadableMetadata>(
    `/v1/agent-services/${encodeURIComponent(id)}/metadata`,
  );
  if (remote !== null) return remote;
  return getAgentMetadata(id);
}

/** A public seller profile by slug. */
export async function fetchSeller(slug: string): Promise<SellerDTO | null> {
  const remote = await tryRemote<SellerDTO>(
    `/v1/marketplace/sellers/${encodeURIComponent(slug)}`,
  );
  if (remote !== null) return remote;
  return getSeller(slug);
}
