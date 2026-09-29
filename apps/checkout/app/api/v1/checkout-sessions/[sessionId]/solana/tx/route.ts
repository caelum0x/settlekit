/**
 * Solana Pay transaction request for a checkout session.
 *
 *   GET  -> { label, icon }                      (wallet shows who is charging)
 *   POST { account } -> { transaction, message } (unsigned base64 v0 tx)
 *
 * The server builds the USDC transfer (merchant ATA create-idempotent +
 * TransferChecked for the exact session amount, session reference attached),
 * so the buyer's wallet cannot alter recipient, mint or amount. CORS is open
 * because Solana Pay wallets call this endpoint cross-origin.
 */
import { NextResponse } from "next/server";

import { toRouteError } from "@/lib/errors";
import { publicOrigin } from "@/lib/origin";
import { buildSolanaTransaction, describeSolanaMerchant } from "@/lib/solana-checkout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
} as const;

function reply(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { label } = await describeSolanaMerchant(context.params.sessionId);
    return reply({ label, icon: `${publicOrigin(request)}/icon.png` });
  } catch (error) {
    const { status, error: message } = toRouteError(error, "Could not load the checkout session.");
    return reply({ error: message }, status);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply({ error: "Request body must be valid JSON." }, 400);
  }
  try {
    const tx = await buildSolanaTransaction({
      sessionId: context.params.sessionId,
      account: (body as { account?: unknown } | null)?.account,
    });
    return reply(tx);
  } catch (error) {
    const { status, error: message } = toRouteError(error, "Could not build the Solana transaction.");
    if (status === 500) console.error("[checkout] solana tx build failed:", error);
    return reply({ error: message }, status);
  }
}
