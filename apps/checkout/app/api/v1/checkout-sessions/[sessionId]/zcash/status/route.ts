/**
 * GET /api/v1/checkout-sessions/:sessionId/zcash/status
 *
 * Polled by the checkout page. Finds the session's Zcash payment (a claimed
 * txid, else one cached address scan per payTo per minute matched by the
 * exact tagged amount), verifies it in full and settles it once final.
 * Returns waiting | confirming | review (paid after the quote expired) | paid.
 */
import { NextResponse } from "next/server";

import { errorReply } from "@/lib/route-helpers";
import { getZcashStatus, type ZcashStatusResponse } from "@/lib/zcash-checkout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    return NextResponse.json<ZcashStatusResponse>(await getZcashStatus(context.params.sessionId));
  } catch (error) {
    return errorReply(error, "Could not check the Zcash network. Retrying.", "zcash status", 502);
  }
}
