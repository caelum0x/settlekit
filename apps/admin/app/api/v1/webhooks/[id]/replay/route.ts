import { replayWebhook } from "@/lib/service";
import { ok, fail } from "@/lib/respond";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const result = await replayWebhook(params.id);
    if (!result) return fail("webhook event not found", 404);
    return ok(result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "replay failed", 500);
  }
}
