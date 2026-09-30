// Streams a merchant accounting export (CSV) with the signed-in session.
// Only the known report names are forwarded; the API scopes to the tenant.
import { NextResponse } from "next/server";
import { fetchApiRaw } from "@/lib/api";

export const dynamic = "force-dynamic";

const REPORTS = new Set(["payments", "refunds", "invoices", "payouts", "ledger", "xero", "quickbooks"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request, { params }: { params: { report: string } }): Promise<Response> {
  const report = params.report.replace(/\.csv$/, "");
  if (!REPORTS.has(report)) return NextResponse.json({ error: "unknown export" }, { status: 404 });
  const url = new URL(request.url);
  const qs = new URLSearchParams();
  for (const key of ["from", "to"]) {
    const value = url.searchParams.get(key);
    if (value && DATE_RE.test(value)) qs.set(key, value);
  }
  const upstream = await fetchApiRaw(`/v1/exports/${report}.csv${qs.size > 0 ? `?${qs.toString()}` : ""}`);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "export unavailable" }, { status: upstream.status === 401 ? 401 : 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": upstream.headers.get("content-disposition") ?? `attachment; filename="${report}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
