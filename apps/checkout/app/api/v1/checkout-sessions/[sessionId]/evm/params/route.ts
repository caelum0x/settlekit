/**
 * GET /api/v1/checkout-sessions/:sessionId/evm/params
 *
 * Wallet parameters for paying the session on its EVM network: chain id and
 * add-chain request (public registry RPC), token, exact base-unit amount,
 * payTo, Tempo memo, confirmation depth and explorer prefix. 503 when the
 * session's chain is not enabled on this checkout (fail closed).
 */
import { NextResponse } from "next/server";

import { getEvmPaymentParams, type EvmPaymentParams } from "@/lib/evm-checkout";
import { errorReply } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    return NextResponse.json<EvmPaymentParams>(await getEvmPaymentParams(context.params.sessionId));
  } catch (error) {
    return errorReply(error, "Could not load the payment details.", "evm params");
  }
}
