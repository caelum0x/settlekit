import { searchAgentServices } from "@/lib/repository";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /v1/agent-services
 *
 * Query params: q (text), network (arc|base), maxPrice, minPrice (USDC).
 * Returns published agent services via @settlekit/agent-services discovery.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const networkParam = url.searchParams.get("network");
  const network =
    networkParam === "arc" || networkParam === "base" ? networkParam : undefined;
  const maxPrice = url.searchParams.get("maxPrice") ?? undefined;
  const minPrice = url.searchParams.get("minPrice") ?? undefined;

  try {
    const services = await searchAgentServices({
      ...(q ? { text: q } : {}),
      ...(network ? { network } : {}),
      ...(maxPrice ? { maxPrice } : {}),
      ...(minPrice ? { minPrice } : {}),
    });
    return jsonOk(services, services.length);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to search services";
    return jsonError(message, 500);
  }
}
