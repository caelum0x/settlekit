/**
 * GET /api/v1/checkout-sessions/:sessionId/solana/status
 *
 * Polled by the checkout page. Looks the session's Solana Pay reference up
 * on-chain; once a transaction includes it, verifies it against the session
 * (mint, merchant, amount, reference), confirms the payment and runs delivery
 * exactly once. Idempotent: every later poll returns the same paid result.
 */
import { NextResponse } from "next/server";

import { toRouteError } from "@/lib/errors";
import { explorerTxUrl } from "@/lib/format";
import { configuredSolanaCluster } from "@/lib/solana";
import { confirmFromReference } from "@/lib/store";
import type { SolanaStatusResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: { sessionId: string };
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const result = await confirmFromReference(context.params.sessionId);
    if (result.status === "pending") {
      return NextResponse.json<SolanaStatusResponse>({ status: "pending" });
    }
    const txHash = result.payment.txHash ?? "";
    return NextResponse.json<SolanaStatusResponse>({
      status: "paid",
      txHash,
      explorerUrl: txHash ? explorerTxUrl("solana", txHash, configuredSolanaCluster()) : "",
    });
  } catch (error) {
    const { status, error: message } = toRouteError(error, "Could not check the Solana network. Retrying.");
    if (status === 500) {
      console.error("[checkout] solana status check failed:", error);
      return NextResponse.json({ error: message }, { status: 502 });
    }
    return NextResponse.json({ error: message }, { status });
  }
}
