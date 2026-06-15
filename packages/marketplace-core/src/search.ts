import type { MarketplaceListing } from "@settlekit/common";

/** Sort strategies supported by {@link searchListings}. */
export type ListingSort = "top" | "new" | "price";

export interface SearchQuery {
  /** Free-text query matched against title, summary, and tags. */
  query?: string;
  /** All of these tags must be present on a listing (AND semantics). */
  tags?: string[];
  /** Ranking strategy applied after filtering. Defaults to "top". */
  sort?: ListingSort;
}

/**
 * A listing paired with optional price context. Marketplace listings do not
 * carry a price themselves (price lives on the referenced product/agent), so a
 * price-base-units lookup is supplied for "price" sorting.
 */
export interface ListingWithContext {
  listing: MarketplaceListing;
  /** Price in integer base units (e.g. USDC micro-units). Lower sorts first. */
  priceBaseUnits?: bigint;
}

interface ScoredListing {
  context: ListingWithContext;
  /** Text relevance score. 0 when no query supplied. */
  score: number;
}

const WORD_SPLIT = /[^a-z0-9]+/i;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter((t) => t.length > 0);
}

/**
 * Compute a real text-relevance score for a listing against query terms.
 *
 * Weights title matches highest, then tags, then summary. Exact whole-token
 * matches score higher than substring (prefix/contains) matches.
 */
export function relevanceScore(
  listing: MarketplaceListing,
  terms: readonly string[],
): number {
  if (terms.length === 0) return 0;

  const titleTokens = new Set(tokenize(listing.title));
  const summaryTokens = new Set(tokenize(listing.summary));
  const tagTokens = new Set(listing.tags.map((t) => t.toLowerCase()));
  const titleLower = listing.title.toLowerCase();
  const summaryLower = listing.summary.toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (titleTokens.has(term)) {
      score += 10;
    } else if (titleLower.includes(term)) {
      score += 5;
    }

    if (tagTokens.has(term)) {
      score += 6;
    }

    if (summaryTokens.has(term)) {
      score += 3;
    } else if (summaryLower.includes(term)) {
      score += 1;
    }
  }
  return score;
}

function matchesTags(
  listing: MarketplaceListing,
  requiredTags: readonly string[],
): boolean {
  if (requiredTags.length === 0) return true;
  const owned = new Set(listing.tags.map((t) => t.toLowerCase()));
  return requiredTags.every((t) => owned.has(t.trim().toLowerCase()));
}

function comparePrice(a: ListingWithContext, b: ListingWithContext): number {
  const ap = a.priceBaseUnits;
  const bp = b.priceBaseUnits;
  // Listings without a known price sort last.
  if (ap === undefined && bp === undefined) return 0;
  if (ap === undefined) return 1;
  if (bp === undefined) return -1;
  if (ap < bp) return -1;
  if (ap > bp) return 1;
  return 0;
}

function compareNewest(a: MarketplaceListing, b: MarketplaceListing): number {
  // ISO-8601 timestamps are lexicographically ordered; newest first.
  if (a.createdAt > b.createdAt) return -1;
  if (a.createdAt < b.createdAt) return 1;
  return 0;
}

function compareTop(a: MarketplaceListing, b: MarketplaceListing): number {
  if (a.ratingAverage !== b.ratingAverage) {
    return b.ratingAverage - a.ratingAverage;
  }
  if (a.ratingCount !== b.ratingCount) {
    return b.ratingCount - a.ratingCount;
  }
  return compareNewest(a, b);
}

/**
 * Filter and rank discoverable listings.
 *
 * Only published listings are considered. A text query (when present) acts as
 * both a filter (zero-relevance listings are dropped) and the primary sort key;
 * the chosen {@link ListingSort} breaks ties. With no query, the sort strategy
 * is applied directly across all tag-matching published listings.
 */
export function searchListings(
  inputs: readonly ListingWithContext[],
  query: SearchQuery = {},
): MarketplaceListing[] {
  const sort: ListingSort = query.sort ?? "top";
  const terms = query.query ? tokenize(query.query) : [];
  const requiredTags = query.tags ?? [];

  const candidates = inputs.filter(
    (c) => c.listing.published && matchesTags(c.listing, requiredTags),
  );

  const scored: ScoredListing[] = candidates
    .map((context) => ({
      context,
      score: relevanceScore(context.listing, terms),
    }))
    .filter((s) => terms.length === 0 || s.score > 0);

  scored.sort((a, b) => {
    if (terms.length > 0 && a.score !== b.score) {
      return b.score - a.score;
    }
    switch (sort) {
      case "price":
        return comparePrice(a.context, b.context);
      case "new":
        return compareNewest(a.context.listing, b.context.listing);
      case "top":
        return compareTop(a.context.listing, b.context.listing);
    }
  });

  return scored.map((s) => s.context.listing);
}
