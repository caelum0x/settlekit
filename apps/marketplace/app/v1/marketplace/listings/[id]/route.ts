import { getListing } from "@/lib/repository";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /v1/marketplace/listings/:id -> a single published listing. */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const listing = await getListing(params.id);
  if (listing === null) {
    return jsonError("Listing not found", 404);
  }
  return jsonOk(listing);
}
