/**
 * GET /api/v1/checkout-sessions/:sessionId/receipt
 *
 * Returns the receipt + delivered access for a completed session. 404 when the
 * session is unknown; 409 when it has not been paid yet (no receipt exists).
 */
import { NextResponse } from "next/server";

import {
  getResolvedSession,
  getConfirmedPayment,
  getDeliveredAccess,
} from "@/lib/store";
import { buildReceiptView } from "@/lib/views";

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

  const payment = await getConfirmedPayment(sessionId);
  if (!payment || resolved.session.status !== "completed") {
    return NextResponse.json(
      { error: "This session has not been paid yet." },
      { status: 409 },
    );
  }

  const access = await getDeliveredAccess(sessionId);
  return NextResponse.json(buildReceiptView(resolved, payment, access));
}
