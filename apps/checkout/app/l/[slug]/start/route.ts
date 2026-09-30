import { NextResponse } from "next/server";

import { PaymentLinkError, startPaymentLinkWithPromo } from "@/lib/payment-link";

export const dynamic = "force-dynamic";

/**
 * POST /l/:slug/start — open a fresh checkout session for this visit.
 * JSON callers get `{ url }`; a plain form POST (no JavaScript) is
 * redirected straight to the checkout.
 */
export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
  try {
    const promo = new URL(request.url).searchParams.get("promo") ?? undefined;
    const started = await startPaymentLinkWithPromo(params.slug, promo);
    const url = `/c/${encodeURIComponent(started.sessionId)}${started.promo === "refused" ? "?promo=refused" : ""}`;
    if (wantsJson) return NextResponse.json({ url });
    return NextResponse.redirect(new URL(url, request.url), 303);
  } catch (error) {
    const status = error instanceof PaymentLinkError ? error.status : 502;
    const message = error instanceof Error ? error.message : "Could not open checkout";
    if (wantsJson) return NextResponse.json({ error: message }, { status: status >= 400 ? status : 502 });
    return NextResponse.redirect(new URL(`/l/${encodeURIComponent(params.slug)}?error=1`, request.url), 303);
  }
}
