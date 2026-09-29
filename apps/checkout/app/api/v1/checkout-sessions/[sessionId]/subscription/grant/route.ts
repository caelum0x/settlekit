/**
 * POST /api/v1/checkout-sessions/:sessionId/subscription/grant
 *
 * Body: { subscriptionId, signature? (EIP-712), approveSignature? (Solana) }
 * Forwards the buyer's signed authorization; the API registers it, charges
 * the first period and delivers access. Returns the buyer's manage link.
 */
import { NextResponse } from "next/server";

import { errorReply, readJsonObject } from "@/lib/route-helpers";
import { assertSameOrigin } from "@/lib/same-origin";
import { completeSubscription } from "@/lib/subscription-checkout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const result = await completeSubscription(context.params.sessionId, {
      subscriptionId: body.subscriptionId,
      signature: body.signature,
      approveSignature: body.approveSignature,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorReply(error, "Could not activate the subscription.", "subscription grant");
  }
}
