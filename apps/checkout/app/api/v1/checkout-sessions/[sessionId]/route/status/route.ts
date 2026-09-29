/**
 * POST /api/v1/checkout-sessions/:sessionId/route/status
 *
 * Body: { originTxHash? } — the origin transaction the buyer's wallet sent
 * (LI.FI tracks routes by it; Relay by request id).
 *
 * Polls the route provider and, once it reports a destination fill,
 * verifies that fill on the session's network with the fail-closed verifier
 * (Transfer to payTo >= amount owed, after session creation, unique hash).
 * A provider "success" alone never marks the order paid.
 */
import { NextResponse } from "next/server";

import { getRouteStatusView, type RouteStatusView } from "@/lib/any-token";
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
    return NextResponse.json<RouteStatusView>(
      await getRouteStatusView({ sessionId: context.params.sessionId, originTxHash: body.originTxHash }),
    );
  } catch (error) {
    return errorReply(error, "Could not check the cross-chain payment. Retrying.", "route status", 502);
  }
}
