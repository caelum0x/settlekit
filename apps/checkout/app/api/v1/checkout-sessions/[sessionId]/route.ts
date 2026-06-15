/**
 * GET /api/v1/checkout-sessions/:sessionId
 *
 * Returns the full checkout session view (order summary, pay-to address,
 * network, required buyer fields). 404 when unknown; 410 when expired.
 */
import { NextResponse } from "next/server";

import { getResolvedSession } from "@/lib/store";
import { buildSessionView } from "@/lib/views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { sessionId } = context.params;
  const resolved = await getResolvedSession(sessionId);

  if (!resolved) {
    return NextResponse.json(
      { error: "Checkout session not found." },
      { status: 404 },
    );
  }

  if (resolved.expired && resolved.session.status !== "completed") {
    return NextResponse.json(
      { error: "This checkout session has expired." },
      { status: 410 },
    );
  }

  return NextResponse.json(buildSessionView(resolved));
}
