/**
 * POST /api/v1/checkout-sessions/:sessionId/tax
 *
 * Body: { country: "FR", vatId?: "FR12345678901" }
 *
 * Sets the buyer's billing country (and optional VAT ID) and recomputes the
 * tax-inclusive amount due while the session is open and unpaid.
 */
import { NextResponse } from "next/server";

import { applyBuyerTax } from "@/lib/buyer-tax";
import { errorReply, readJsonObject } from "@/lib/route-helpers";
import { assertSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const session = await applyBuyerTax(context.params.sessionId, { country: body.country, vatId: body.vatId });
    return NextResponse.json({ amount: session.amount, tax: session.tax ?? null });
  } catch (error) {
    return errorReply(error, "Could not update the billing details.", "tax");
  }
}
