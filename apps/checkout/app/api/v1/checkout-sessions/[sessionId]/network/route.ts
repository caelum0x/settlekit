/**
 * POST /api/v1/checkout-sessions/:sessionId/network
 *
 * Body: { network: PaymentNetwork }
 *
 * Switches the session to one of the networks the merchant accepted, only
 * while the session is open and nothing is recorded against it. Sets the
 * network's payTo; for Zcash locks a ZEC quote (a live quote is kept).
 * 422 unaccepted network, 503 network not configured here, 409 not payable.
 */
import { NextResponse } from "next/server";

import { selectNetwork } from "@/lib/network-select";
import { errorReply, readJsonObject } from "@/lib/route-helpers";
import { assertSameOrigin } from "@/lib/same-origin";
import type { NetworkSelectResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const session = await selectNetwork(context.params.sessionId, body.network);
    return NextResponse.json<NetworkSelectResponse>({
      network: session.network,
      payToAddress: session.payToAddress,
      settlementQuote: session.settlementQuote ?? null,
    });
  } catch (error) {
    return errorReply(error, "Could not change the payment network.", "network select");
  }
}
