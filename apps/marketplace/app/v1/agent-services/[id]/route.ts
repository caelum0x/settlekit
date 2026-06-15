import { getAgentService } from "@/lib/repository";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /v1/agent-services/:id -> a single published agent service. */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const service = await getAgentService(params.id);
  if (service === null) {
    return jsonError("Agent service not found", 404);
  }
  return jsonOk(service);
}
