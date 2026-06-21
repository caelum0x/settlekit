import { listSettlements } from "@/lib/service";
import { fail } from "@/lib/respond";
import { toCsv, type CsvColumn } from "@/lib/analytics";
import type { AdminSettlement } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * CSV export for admin reports.
 *
 * This route intentionally lives OUTSIDE /api/v1 and does NOT use the
 * {ok,data,error} envelope on its success path — it returns a raw text/csv
 * Response so browsers download a file. The error path still uses fail() (JSON)
 * since there is nothing to download. It reads the service layer directly
 * (server-only) rather than going back through the HTTP api.ts client.
 */

const SETTLEMENT_COLUMNS: ReadonlyArray<CsvColumn<AdminSettlement>> = [
  { header: "id", value: (s) => s.id },
  { header: "organizationId", value: (s) => s.organizationId },
  { header: "status", value: (s) => s.status },
  { header: "amount", value: (s) => s.amount.amount },
  { header: "currency", value: (s) => s.amount.currency },
  { header: "network", value: (s) => s.network },
  { header: "reference", value: (s) => s.reference },
  { header: "txHash", value: (s) => s.txHash ?? "" },
  { header: "createdAt", value: (s) => s.createdAt },
  { header: "updatedAt", value: (s) => s.updatedAt },
];

async function settlementsCsv(): Promise<string> {
  const settlements = await listSettlements();
  const sorted = [...settlements].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return toCsv(sorted, SETTLEMENT_COLUMNS);
}

export async function GET(
  _request: Request,
  { params }: { params: { report: string } },
) {
  const report = params.report;
  if (report !== "settlements") {
    return fail(`unknown report: ${report}`, 404);
  }

  try {
    const csv = await settlementsCsv();
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="settlements.csv"',
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "export failed", 500);
  }
}
