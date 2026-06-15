import { fetchAgentMetadata } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Agent-readable metadata endpoint (plan §11).
 *
 * GET /agents/:id/metadata.json -> the machine-readable JSON document an agent
 * reads to learn how to call and pay for the service. Served with
 * content-type application/json. Generated from the real agent-services package
 * via the API client (remote API first, in-process repository fallback).
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const metadata = await fetchAgentMetadata(params.id);

  if (metadata === null) {
    return new Response(
      JSON.stringify({ error: "Agent service not found", id: params.id }),
      {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  return new Response(JSON.stringify(metadata, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      // Allow agents on other origins to fetch the discovery document.
      "access-control-allow-origin": "*",
    },
  });
}
