import { NextResponse } from "next/server";

import { invoicePdfApiUrl, isInvoiceToken } from "@/lib/invoice-link";

export const dynamic = "force-dynamic";

/** GET /i/:token/pdf: stream the invoice (or receipt, once paid) PDF. */
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  if (!isInvoiceToken(params.token)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const upstream = await fetch(invoicePdfApiUrl(params.token), { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "invoice unavailable" }, { status: upstream.status === 404 ? 404 : 502 });
  }
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store",
    },
  });
}
