/**
 * GET  /api/v1/checkout-sessions/:sessionId/subscription
 *      What subscribing looks like on the session's network (methods, cap, expiry).
 * POST /api/v1/checkout-sessions/:sessionId/subscription
 *      Body: { method, payer?, fields } -> the intent the buyer's wallet signs/sends.
 */
import { NextResponse } from "next/server";

import { errorReply, fieldsOf, readJsonObject } from "@/lib/route-helpers";
import { assertSameOrigin } from "@/lib/same-origin";
import { getSubscriptionOffer, startSubscription } from "@/lib/subscription-checkout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    return NextResponse.json(await getSubscriptionOffer(context.params.sessionId));
  } catch (error) {
    return errorReply(error, "Could not load subscription options.", "subscription offer");
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const result = await startSubscription(context.params.sessionId, {
      method: body.method,
      payer: body.payer,
      fields: fieldsOf(body),
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorReply(error, "Could not start the subscription.", "subscription start");
  }
}
