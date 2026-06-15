import { getSeller } from "@/lib/repository";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /v1/marketplace/sellers/:slug -> public seller profile. */
export async function GET(
  _request: Request,
  { params }: { params: { slug: string } },
): Promise<Response> {
  const seller = await getSeller(params.slug);
  if (seller === null) {
    return jsonError("Seller not found", 404);
  }
  return jsonOk(seller);
}
