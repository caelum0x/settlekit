import { retryDeliveryRun } from "@/lib/service";
import { ok, fail } from "@/lib/respond";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const result = await retryDeliveryRun(params.id);
    if (!result) return fail("delivery run not found", 404);
    return ok(result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "retry failed", 500);
  }
}
