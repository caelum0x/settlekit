import {
  generateId,
  toIso,
  validationError,
  type MarketplaceListing,
} from "@settlekit/common";

/**
 * Input accepted by {@link createListing}. A listing must reference exactly one
 * underlying sellable: a catalog product OR an agent service.
 */
export interface CreateListingInput {
  organizationId: string;
  merchantId: string;
  productId?: string;
  agentServiceId?: string;
  title: string;
  summary: string;
  tags: string[];
}

const MAX_TITLE_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 2_000;
const MAX_TAGS = 32;

/** Lower-case, trim, and de-duplicate tags so search/match is deterministic. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * Build a new, unpublished {@link MarketplaceListing} from caller input.
 *
 * Throws a validation error when the input is malformed. The returned listing
 * starts unpublished with a zeroed rating aggregate; callers must
 * {@link publishListing} it before it becomes discoverable.
 */
export function createListing(
  input: CreateListingInput,
  now: Date = new Date(),
): MarketplaceListing {
  const title = input.title.trim();
  const summary = input.summary.trim();

  if (title.length === 0) {
    throw validationError("Listing title is required");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw validationError("Listing title is too long", {
      max: MAX_TITLE_LENGTH,
    });
  }
  if (summary.length > MAX_SUMMARY_LENGTH) {
    throw validationError("Listing summary is too long", {
      max: MAX_SUMMARY_LENGTH,
    });
  }

  const hasProduct = input.productId !== undefined;
  const hasAgent = input.agentServiceId !== undefined;
  if (hasProduct === hasAgent) {
    throw validationError(
      "Listing must reference exactly one of productId or agentServiceId",
    );
  }

  const tags = normalizeTags(input.tags);
  if (tags.length > MAX_TAGS) {
    throw validationError("Too many tags", { max: MAX_TAGS });
  }

  const listing: MarketplaceListing = {
    id: generateId("marketplaceListing"),
    organizationId: input.organizationId,
    merchantId: input.merchantId,
    title,
    summary,
    tags,
    published: false,
    ratingAverage: 0,
    ratingCount: 0,
    createdAt: toIso(now),
  };

  if (input.productId !== undefined) {
    return { ...listing, productId: input.productId };
  }
  return { ...listing, agentServiceId: input.agentServiceId };
}

/** Return a published copy of the listing (immutable). */
export function publishListing(
  listing: MarketplaceListing,
): MarketplaceListing {
  if (listing.published) return listing;
  return { ...listing, published: true };
}

/** Return an unpublished copy of the listing (immutable). */
export function unpublishListing(
  listing: MarketplaceListing,
): MarketplaceListing {
  if (!listing.published) return listing;
  return { ...listing, published: false };
}

/**
 * A listing is discoverable only when published and wired to a real sellable.
 */
export function isDiscoverable(listing: MarketplaceListing): boolean {
  return (
    listing.published &&
    (listing.productId !== undefined || listing.agentServiceId !== undefined)
  );
}
