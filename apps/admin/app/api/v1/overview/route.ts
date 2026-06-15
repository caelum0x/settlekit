import { platformOverview } from "@/lib/service";
import { ok, fail } from "@/lib/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await platformOverview());
  } catch (e) {
    return fail(e instanceof Error ? e.message : "overview failed", 500);
  }
}
