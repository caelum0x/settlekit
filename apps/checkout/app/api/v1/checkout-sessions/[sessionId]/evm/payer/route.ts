/**
 * POST /api/v1/checkout-sessions/:sessionId/evm/payer
 *
 * Body: { payer: "0x…", fields: Record<string,string> }
 *
 * Saves the buyer's delivery details and binds the connected wallet as the
 * payer: only a transfer sent FROM it can settle the session.
 */
import { NextResponse } from "next/server";

import { declareEvmPayer } from "@/lib/evm-checkout";
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
    const result = await declareEvmPayer({ sessionId: context.params.sessionId, payer: body.payer, fields: fieldsOf(body) });
    return NextResponse.json(result);
  } catch (error) {
    return errorReply(error, "Could not save the paying wallet.", "evm payer");
  }
}
