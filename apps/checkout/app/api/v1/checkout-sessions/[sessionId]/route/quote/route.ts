/**
 * GET  /api/v1/checkout-sessions/:sessionId/route/quote
 *   Origins the buyer may pay from (routing policy) and the current route.
 *
 * POST /api/v1/checkout-sessions/:sessionId/route/quote
 *   Body: { originChainId, originToken, originAddress, depositAddress, fields }
 *   EXACT_OUTPUT route quote (Relay, LI.FI fallback) to the merchant's payTo
 *   with the buyer as refund address, checked against the fee / slippage /
 *   origin policy and stored on the session. 422 when no compliant route
 *   exists, 502 when the providers are unreachable, 503 when disabled.
 */
import { NextResponse } from "next/server";

import { getAnyTokenOptions, quoteRoute, type AnyTokenOptionsResponse, type RouteQuoteView } from "@/lib/any-token";
import { errorReply, fieldsOf, readJsonObject } from "@/lib/route-helpers";
import { assertSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    return NextResponse.json<AnyTokenOptionsResponse>(await getAnyTokenOptions(context.params.sessionId));
  } catch (error) {
    return errorReply(error, "Could not load the payment options.", "route options");
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const quote = await quoteRoute({
      sessionId: context.params.sessionId,
      originChainId: body.originChainId,
      originToken: body.originToken,
      originAddress: body.originAddress,
      depositAddress: body.depositAddress,
      fields: fieldsOf(body),
    });
    return NextResponse.json<RouteQuoteView>(quote);
  } catch (error) {
    return errorReply(error, "Could not quote a route for this payment.", "route quote", 502);
  }
}
