import { allListingTags } from "@/lib/repository";
import { jsonOk } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /v1/marketplace/tags -> distinct tag facet across published listings. */
export async function GET(): Promise<Response> {
  const tags = await allListingTags();
  return jsonOk(tags, tags.length);
}
