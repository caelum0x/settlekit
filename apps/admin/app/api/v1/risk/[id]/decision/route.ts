import { decideRisk, type RiskAction } from "@/lib/service";
import { ok, fail } from "@/lib/respond";

export const dynamic = "force-dynamic";

const VALID: ReadonlySet<RiskAction> = new Set(["allow", "review", "block"]);

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  let action: unknown;
  try {
    const body = (await req.json()) as { action?: unknown };
    action = body.action;
  } catch {
    return fail("invalid JSON body", 400);
  }

  if (typeof action !== "string" || !VALID.has(action as RiskAction)) {
    return fail("action must be one of: allow, review, block", 422);
  }

  try {
    const updated = await decideRisk(params.id, action as RiskAction);
    if (!updated) return fail("risk profile not found", 404);
    return ok(updated);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "decision failed", 500);
  }
}
