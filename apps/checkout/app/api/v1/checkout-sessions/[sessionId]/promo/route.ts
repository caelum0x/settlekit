/**
 * POST /api/v1/checkout-sessions/:sessionId/promo
 *
 * Body: { code: string }
 *
 * Applies a seller promo code while the session is open and unpaid; the
 * discounted total becomes the amount due. 400 with the reason when the code
 * is refused, 409 when the session can no longer change.
 */
import { NextResponse } from "next/server";

import { applyPromoCode } from "@/lib/promo";
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
    const session = await applyPromoCode(context.params.sessionId, body.code);
    return NextResponse.json({
      amount: session.amount,
      discount: session.discount ?? null,
      settlementQuote: session.settlementQuote ?? null,
    });
  } catch (error) {
    return errorReply(error, "Could not apply the promo code.", "promo");
  }
}
