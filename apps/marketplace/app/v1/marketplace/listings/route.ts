import { searchListings } from "@/lib/repository";
import { jsonOk, jsonError } from "@/lib/http";
import type { ListingSearchParams } from "@/lib/repository";

export const dynamic = "force-dynamic";

/**
 * GET /v1/marketplace/listings
 *
 * Query params: q (text), tags (comma-separated, AND), sort (top|new|price).
 * Returns published listings via @settlekit/marketplace-core search.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const rawTags = url.searchParams.get("tags") ?? "";
  const tags = rawTags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const sortParam = url.searchParams.get("sort") ?? "top";
  const sort: ListingSearchParams["sort"] =
    sortParam === "new" || sortParam === "price" ? sortParam : "top";

  try {
    const listings = await searchListings({
      ...(q ? { query: q } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      sort,
    });
    return jsonOk(listings, listings.length);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to search listings";
    return jsonError(message, 500);
  }
}
