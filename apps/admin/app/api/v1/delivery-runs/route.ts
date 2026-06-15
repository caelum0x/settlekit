import { listDeliveryRuns, listFailedDeliveryRuns } from "@/lib/service";
import { ok, fail } from "@/lib/respond";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const status = new URL(req.url).searchParams.get("status");
    const runs =
      status === "failed"
        ? await listFailedDeliveryRuns()
        : await listDeliveryRuns();
    return ok(runs);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "delivery list failed", 500);
  }
}
