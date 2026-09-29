/**
 * POST /api/v1/checkout-sessions/:sessionId/zcash/uri
 *
 * Body: { fields: Record<string,string> }
 *
 * Saves the buyer's delivery details and returns the ZIP-321 payment request
 * for the session's locked ZEC quote (QR payload, address, exact amount,
 * quote expiry). 503 when Zcash is not enabled on this checkout.
 */
import { NextResponse } from "next/server";

import { errorReply, fieldsOf, readJsonObject } from "@/lib/route-helpers";
import { assertSameOrigin } from "@/lib/same-origin";
import { prepareZcashPayment, type ZcashUriResponse } from "@/lib/zcash-checkout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const uri = await prepareZcashPayment({ sessionId: context.params.sessionId, fields: fieldsOf(body) });
    return NextResponse.json<ZcashUriResponse>(uri);
  } catch (error) {
    return errorReply(error, "Could not prepare the Zcash payment.", "zcash uri");
  }
}
