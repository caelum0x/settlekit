import {
  getOrganization,
  listPayments,
  listEntitlements,
  listDeliveryRuns,
} from "@/lib/service";
import { ok, fail } from "@/lib/respond";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const organization = await getOrganization(params.id);
    if (!organization) return fail("organization not found", 404);

    const [payments, entitlements, runs] = await Promise.all([
      listPayments(),
      listEntitlements(),
      listDeliveryRuns(),
    ]);

    return ok({
      organization,
      payments: payments.filter((p) => p.organizationId === params.id),
      entitlements: entitlements.filter((e) => e.organizationId === params.id),
      deliveryRuns: runs.filter((r) => r.organizationId === params.id),
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "lookup failed", 500);
  }
}
