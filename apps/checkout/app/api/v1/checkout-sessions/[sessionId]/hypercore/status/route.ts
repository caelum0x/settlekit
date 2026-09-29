/**
 * POST /api/v1/checkout-sessions/:sessionId/hypercore/status
 *
 * Body: { nonce: number } — the signed action's time.
 *
 * Polled after submission: looks the transfer up in the payee's ledger
 * (bound payer + nonce) and settles it through the fail-closed confirm path.
 */
import { NextResponse } from "next/server";

import { settleHyperCoreSubmission, type HyperCoreStatusResponse } from "@/lib/hypercore-checkout";
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
    const nonce = typeof body.nonce === "number" ? body.nonce : Number.NaN;
    return NextResponse.json<HyperCoreStatusResponse>(await settleHyperCoreSubmission(context.params.sessionId, nonce));
  } catch (error) {
    return errorReply(error, "Could not check the HyperCore transfer. Retrying.", "hypercore status", 502);
  }
}
