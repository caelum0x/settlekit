/**
 * GET /api/v1/checkout-sessions/:sessionId/hypercore/params
 *
 * What the buyer's EVM wallet signs to pay on HyperCore: the Hyperliquid
 * `usdSend` EIP-712 domain/types, destination (payTo), canonical USD amount
 * and `hyperliquidChain`. 503 when HyperCore is not enabled (fail closed).
 */
import { NextResponse } from "next/server";

import { getHyperCorePaymentParams, type HyperCorePaymentParams } from "@/lib/hypercore-checkout";
import { errorReply } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    return NextResponse.json<HyperCorePaymentParams>(await getHyperCorePaymentParams(context.params.sessionId));
  } catch (error) {
    return errorReply(error, "Could not load the HyperCore payment details.", "hypercore params");
  }
}
