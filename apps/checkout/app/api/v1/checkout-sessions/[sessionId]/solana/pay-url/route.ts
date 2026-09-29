/**
 * POST /api/v1/checkout-sessions/:sessionId/solana/pay-url
 *
 * Body: { fields: Record<string,string> }
 *
 * Validates + saves the buyer's delivery fields, then returns the Solana Pay
 * request for the session (transfer-request URL for the QR, transaction-request
 * URL, the session reference and cluster). Fails closed with 503 when Solana is
 * not configured on this checkout.
 */
import { NextResponse } from "next/server";

import { toRouteError } from "@/lib/errors";
import { prepareSolanaPayment } from "@/lib/solana-checkout";
import { publicOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const rawFields = (body as { fields?: unknown } | null)?.fields;
  const fields =
    rawFields !== null && typeof rawFields === "object" ? (rawFields as Record<string, unknown>) : {};

  try {
    const payUrl = await prepareSolanaPayment({
      sessionId: context.params.sessionId,
      fields,
      origin: publicOrigin(request),
    });
    return NextResponse.json(payUrl);
  } catch (error) {
    const { status, error: message } = toRouteError(error, "Could not prepare the Solana payment.");
    if (status === 500) console.error("[checkout] solana pay-url failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
