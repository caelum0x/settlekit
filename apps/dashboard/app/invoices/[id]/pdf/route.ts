// Streams an invoice (or receipt, once paid) PDF for the signed-in merchant.
// The API enforces tenant ownership; this route only forwards the session.
import { NextResponse } from "next/server";
import { fetchApiRaw } from "@/lib/api";

export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  if (!ID_RE.test(params.id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const upstream = await fetchApiRaw(`/v1/invoices/${params.id}.pdf`);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "invoice unavailable" }, { status: upstream.status === 404 ? 404 : 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store",
    },
  });
}
