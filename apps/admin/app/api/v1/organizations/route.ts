import { listOrganizations } from "@/lib/service";
import { ok, fail } from "@/lib/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await listOrganizations());
  } catch (e) {
    return fail(e instanceof Error ? e.message : "list failed", 500);
  }
}
