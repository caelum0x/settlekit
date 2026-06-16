/**
 * x402 paid-API routes (plan §5) — a REAL pay-per-call endpoint that humans and
 * AI agents can pay for in USDC.
 *
 *   GET /v1/paid/research
 *
 * Flow (handled by `@settlekit/x402` `withSettleKitPayment`):
 *   1. No `X-Payment` header  -> HTTP 402 with a PaymentRequirements document.
 *   2. Payment proof present  -> verified on-chain via the Arc verifier.
 *   3. Verified               -> the paid response is returned, and the call is
 *                                metered through the usage engine (one
 *                                `paid_calls` unit per payer).
 *
 * On-chain settlement requires Arc to be configured (ARC_RPC_URL). Without it,
 * the 402 challenge is still fully functional and any presented proof is
 * honestly rejected (no mock acceptance).
 */
import { Hono } from "hono";
import { withSettleKitPayment, type PaymentVerifier } from "@settlekit/x402";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import type { AppEnv, AppContext } from "../context.js";

/** Demo product id the paid endpoint meters against. */
const X402_PRODUCT_ID = "prod_x402_research";

/** Build the verifier: the real Arc verifier when configured, else honest reject. */
function verifierFor(ctx: AppContext): PaymentVerifier {
  return (
    ctx.arcVerifier ??
    (async () => ({ ok: false, reason: "x402 settlement requires Arc (set ARC_RPC_URL)" }))
  );
}

export function x402Routes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/research", async (c) => {
    const ctx = c.get("ctx");
    const payTo = process.env.X402_PAY_TO ?? "0x0000000000000000000000000000000000000000";

    const paid = withSettleKitPayment({
      price: "0.005",
      currency: "USDC",
      network: "arc",
      payTo,
      productId: X402_PRODUCT_ID,
      verify: verifierFor(ctx),
      // Meter every settled call: one `paid_calls` unit, attributed to the payer.
      settleAndMeter: async ({ proof }) => {
        await ctx.usage.record(
          {
            organizationId: DEFAULT_ORG_ID,
            customerId: proof.from && proof.from.length > 0 ? proof.from : "x402_agent",
            productId: X402_PRODUCT_ID,
            metric: "paid_calls",
          },
          1,
          new Date(),
        );
      },
    })(async () =>
      Response.json({
        data: {
          answer: "Paid research result: USDC settles on Arc in seconds.",
          generatedAt: new Date().toISOString(),
        },
      }),
    );

    // Delegate to the wrapped Fetch handler with the underlying Request and
    // return its Response (the 402 challenge or the paid payload) directly.
    return paid(c.req.raw);
  });

  return app;
}
