import { listRiskProfiles } from "@/lib/service";
import { ok, fail } from "@/lib/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profiles = await listRiskProfiles();
    // Highest score first so the riskiest subjects surface at the top.
    const sorted = [...profiles].sort((a, b) => b.score - a.score);
    return ok(sorted);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "risk list failed", 500);
  }
}
