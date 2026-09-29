/**
 * POST /api/subscriptions/:token/cancel
 *
 * Buyer cancel from the manage page. Stops charges at the end of the paid
 * period and returns the wallet action that revokes the on-chain allowance
 * (the operator stops pulling either way).
 */
import { NextResponse } from "next/server";

import { cancelManagedSubscription } from "@/lib/manage-subscription";
import { errorReply } from "@/lib/route-helpers";
import { assertSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { token: string };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    return NextResponse.json(await cancelManagedSubscription(context.params.token));
  } catch (error) {
    return errorReply(error, "Could not cancel the subscription.", "subscription cancel");
  }
}
