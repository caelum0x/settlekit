import { getAgentMetadata } from "@/lib/repository";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /v1/agent-services/:id/metadata
 *
 * The plan §11 agent-readable metadata, wrapped in the standard API envelope.
 * (For the raw agent-facing document, use /agents/:id/metadata.json on the web
 * app, which serves bare application/json.)
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const metadata = await getAgentMetadata(params.id);
  if (metadata === null) {
    return jsonError("Agent service not found", 404);
  }
  return jsonOk(metadata);
}
