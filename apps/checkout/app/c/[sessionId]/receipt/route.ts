import { NextResponse } from "next/server";

import { apiBaseUrl } from "@/lib/payment-link";

export const dynamic = "force-dynamic";

const SESSION_RE = /^[A-Za-z0-9_-]{8,100}$/;

/** GET /c/:sessionId/receipt: the tax-grade receipt PDF of a settled checkout. */
export async function GET(_request: Request, { params }: { params: { sessionId: string } }) {
  if (!SESSION_RE.test(params.sessionId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const upstream = await fetch(`${apiBaseUrl()}/v1/public/receipts/${encodeURIComponent(params.sessionId)}/pdf`, {
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "receipt unavailable" }, { status: upstream.status === 404 ? 404 : 502 });
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
