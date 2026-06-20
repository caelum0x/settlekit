import { listSettlements } from "@/lib/service";
import { ok, fail } from "@/lib/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settlements = await listSettlements();
    // Newest first so the most recent settlement activity surfaces at the top.
    const sorted = [...settlements].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    return ok(sorted);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "settlement list failed", 500);
  }
}
