/**
 * A runnable Express (TypeScript) paid-API example that sells API calls in USDC
 * via the x402 "HTTP 402 pay-per-call" protocol, using `@settlekit/x402`.
 *
 * Routes:
 *   - GET /health   — FREE. Liveness probe.
 *   - GET /research — PAID. Gated behind a verified x402 USDC payment.
 *
 * The paid route is built from a web Fetch handler wrapped by
 * `withSettleKitPayment(...)`, then adapted to Express via `expressFromFetch`.
 * An unpaid call returns `402` with the payment requirements; the client pays
 * USDC on-chain and retries with an `X-Payment` header carrying the proof.
 */
import express from "express";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

import { withSettleKitPayment } from "./x402.js";
import type { FetchHandler } from "./x402.js";
import { createSettleKitVerifier } from "./verify.js";
import { expressFromFetch } from "./express-adapter.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

/**
 * Destination address that receives the USDC payment. Required for the paid
 * route to advertise valid requirements; fail fast if it is missing.
 */
const PAY_TO = process.env.PAY_TO;
if (PAY_TO === undefined || PAY_TO.length === 0) {
  throw new Error(
    "PAY_TO is not configured. Set PAY_TO to the USDC destination address " +
      "(e.g. PAY_TO=0xYourAddress).",
  );
}

/**
 * The protected resource, as a pure Fetch handler. It only ever runs AFTER the
 * x402 middleware has confirmed a valid payment, so here we simply return the
 * paid result.
 */
const researchHandler: FetchHandler = async (_request: Request): Promise<Response> => {
  const body = {
    data: {
      productId: "prod_research",
      report: {
        title: "Market research: USDC pay-per-call APIs",
        summary:
          "This premium report was unlocked by a verified x402 USDC payment.",
        generatedAt: new Date().toISOString(),
        findings: [
          "x402 lets servers charge per API call without accounts or invoices.",
          "Clients pay USDC on-chain, then retry with an X-Payment proof header.",
          "SettleKit verifies the on-chain settlement before serving the result.",
        ],
      },
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};

/**
 * The SettleKit-backed payment verifier. Confirms each X-Payment proof against
 * the SettleKit API and honestly rejects when verification is unconfigured.
 */
const verify = createSettleKitVerifier();

/**
 * Gate the research handler behind a verified x402 payment of 0.005 USDC on the
 * `arc` network.
 */
const paidResearch = withSettleKitPayment({
  price: "0.005",
  currency: "USDC",
  network: "arc",
  payTo: PAY_TO,
  productId: "prod_research",
  verify,
})(researchHandler);

const app = express();

// FREE route — no payment required.
app.get("/health", (_req: ExpressRequest, res: ExpressResponse) => {
  res.json({
    data: {
      status: "ok",
      service: "settlekit-express-paid-api",
      time: new Date().toISOString(),
    },
  });
});

// PAID route — wrapped Fetch handler adapted to Express.
app.get("/research", expressFromFetch(paidResearch));

// 404 fallback in the SettleKit envelope shape.
app.use((_req: ExpressRequest, res: ExpressResponse) => {
  res.status(404).json({
    error: { code: "not_found", message: "route not found" },
  });
});

app.listen(PORT, () => {
  console.log(
    `settlekit-express-paid-api listening on http://localhost:${PORT}\n` +
      `  FREE  GET /health\n` +
      `  PAID  GET /research  (0.005 USDC via x402, payTo=${PAY_TO})`,
  );
});
