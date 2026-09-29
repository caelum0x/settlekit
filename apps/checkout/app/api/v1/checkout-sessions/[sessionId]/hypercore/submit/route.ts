/**
 * POST /api/v1/checkout-sessions/:sessionId/hypercore/submit
 *
 * Body: { action: UsdSendAction, signature: "0x…", fields }
 *
 * Validates the buyer-signed usdSend against the session (destination,
 * amount, chain, fresh nonce), binds the recovered signer as payer, submits
 * it to Hyperliquid and settles it once it appears in the payee's ledger.
 * Returns waiting (poll hypercore/status) | paid | failed.
 */
import { NextResponse } from "next/server";

import { submitHyperCorePayment, type HyperCoreStatusResponse } from "@/lib/hypercore-checkout";
import { errorReply, fieldsOf, readJsonObject } from "@/lib/route-helpers";
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
    const result = await submitHyperCorePayment({
      sessionId: context.params.sessionId,
      action: body.action,
      signature: body.signature,
      fields: fieldsOf(body),
    });
    return NextResponse.json<HyperCoreStatusResponse>(result);
  } catch (error) {
    return errorReply(error, "Could not submit the HyperCore transfer.", "hypercore submit", 502);
  }
}
