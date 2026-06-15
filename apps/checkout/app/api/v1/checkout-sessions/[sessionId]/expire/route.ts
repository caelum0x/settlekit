/**
 * POST /api/v1/checkout-sessions/:sessionId/expire
 *
 * Transitions an open session to "expired" via the real domain function. Used
 * by the cancel/abandon flow. Idempotent: no-ops for non-open sessions.
 */
import { NextResponse } from "next/server";

import { getResolvedSession, markExpired } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function POST(
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
  await markExpired(sessionId);
  return NextResponse.json({ ok: true });
}
