import { NextResponse } from "next/server";

import { InvoiceLinkError, startInvoicePayment } from "@/lib/invoice-link";

export const dynamic = "force-dynamic";

/**
 * POST /i/:token/start: open (or reuse) the invoice's checkout session and
 * move the payer to it. A plain form POST works without JavaScript.
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const sessionId = await startInvoicePayment(params.token);
    return NextResponse.redirect(new URL(`/c/${encodeURIComponent(sessionId)}`, request.url), 303);
  } catch (error) {
    const status = error instanceof InvoiceLinkError ? error.status : 502;
    const target = status === 404 ? "/not-found" : `/i/${encodeURIComponent(params.token)}?error=1`;
    return NextResponse.redirect(new URL(target, request.url), 303);
  }
}
