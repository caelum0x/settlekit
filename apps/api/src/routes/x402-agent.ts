/**
 * Agent payments over x402 v2 (x402-foundation `@x402/*` 2.27) on every chain.
 * PUBLIC: the payment is the authorization.
 *
 *   GET  /v1/x402/networks                 what an agent can pay with (no payment)
 *   GET  /v1/x402/research                 sample paid resource (@x402/hono paymentMiddleware)
 *   POST /v1/x402/products/:productId/buy  buy a product: settle FIRST, then record the
 *                                          Payment (unique tx hash), grant the entitlement,
 *                                          run delivery inline and return the artifact
 *   *    /v1/x402/facilitator/*            self-hosted facilitator (see ./x402-evm.ts)
 *
 * One 402 challenge lists every configured network (Solana / Base / Arbitrum
 * via PayAI; Ethereum / HyperEVM / Robinhood via the local facilitator); the
 * agent picks one. Buy body (optional JSON): { email?, githubUsername?, discordUserId? }.
 */
import { Hono, type Context } from "hono";
import type { HTTPRequestContext, PaymentOption, RoutesConfig } from "@x402/core/http";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { AssetAmount } from "@x402/core/types";
import { paymentMiddleware, x402HTTPResourceServer, x402ResourceServer } from "@x402/hono";
import { toAtomicAmount } from "@settlekit/x402-facilitator";
import type { AppEnv } from "../context.js";
import type { AgentPaymentNetwork, AgentPaymentsRuntime } from "../agent-payments/config.js";
import { fulfilAgentPurchase } from "../agent-payments/fulfil.js";
import { fulfilmentError } from "../agent-payments/unfulfilled.js";
import { readBuyer, resolvePurchasable, type Purchasable } from "../agent-payments/purchasable.js";
import { ContextAdapter, settleFirstPayment, type SettleFirstVariables } from "../agent-payments/settle-first.js";
import { data, error } from "../http/respond.js";
import { localFacilitatorRoutes, registerEvmSchemes } from "./x402-evm.js";
import { registerSvmSchemes } from "./x402-svm.js";

interface AgentVariables extends SettleFirstVariables {
  x402Purchase?: Purchasable;
}
type AgentEnv = { Variables: AppEnv["Variables"] & AgentVariables };

const RESEARCH_PATTERN = "GET /research";
const BUY_PATTERN = "POST /products/:productId/buy";

function priceFor(entry: AgentPaymentNetwork, decimalAmount: string): AssetAmount {
  return { asset: entry.asset, amount: toAtomicAmount(decimalAmount, entry.decimals), extra: entry.extra };
}

function staticOption(entry: AgentPaymentNetwork, amount: string, maxTimeoutSeconds: number): PaymentOption {
  return { scheme: "exact", network: entry.caip2, payTo: entry.payTo, price: priceFor(entry, amount), maxTimeoutSeconds };
}

/** Buy options: price resolved per request from the product; settle before delivery. */
function purchaseOption(entry: AgentPaymentNetwork, maxTimeoutSeconds: number): PaymentOption {
  return {
    scheme: "exact",
    network: entry.caip2,
    payTo: entry.payTo,
    maxTimeoutSeconds,
    extra: { paymentFlow: "upfront" },
    price: (context: HTTPRequestContext) => {
      const purchase = (context.adapter as ContextAdapter).context.get("x402Purchase") as Purchasable | undefined;
      if (!purchase) throw new Error("purchase was not resolved before the payment challenge");
      return priceFor(entry, purchase.price.amount);
    },
  };
}

function payerOf(c: Context): string | undefined {
  const header = c.req.header("payment-signature") ?? c.req.header("x-payment");
  if (!header) return undefined;
  try {
    const payload = decodePaymentSignatureHeader(header).payload as Record<string, { from?: unknown } | undefined>;
    const from = payload.authorization?.from ?? payload.permit2Authorization?.from;
    return typeof from === "string" ? from : undefined;
  } catch {
    return undefined;
  }
}

function unavailable(c: Context, runtime: AgentPaymentsRuntime | null): Response {
  return c.json(
    {
      error: {
        code: "agent_payments_unavailable",
        message: "no x402 network is configured on this deployment",
        details: { notes: runtime?.notes ?? [] },
      },
    },
    503,
  );
}

/** Mount under `/v1/x402`. `runtime` null serves the discovery + 503s only. */
export function x402AgentRoutes(runtime: AgentPaymentsRuntime | null): Hono<AgentEnv> {
  const app = new Hono<AgentEnv>();

  app.get("/networks", (c) =>
    data(c, {
      networks: (runtime?.networks ?? []).map(({ network, caip2, env, symbol, asset, decimals, payTo, facilitator, experimental }) => ({
        network,
        caip2,
        env,
        symbol,
        asset,
        decimals,
        payTo,
        facilitator,
        experimental,
      })),
      mpp: runtime?.mpp
        ? { network: "tempo", env: runtime.mpp.env, chainId: runtime.mpp.chainId, currency: runtime.mpp.currency, symbol: runtime.mpp.symbol }
        : null,
      notes: runtime?.notes ?? [],
    }),
  );

  app.route("/facilitator", localFacilitatorRoutes(runtime));

  if (!runtime || runtime.networks.length === 0) {
    app.get("/research", (c) => unavailable(c, runtime));
    app.post("/products/:productId/buy", (c) => unavailable(c, runtime));
    return app;
  }

  const server = new x402ResourceServer([...runtime.facilitators]);
  registerEvmSchemes(server, runtime.networks);
  registerSvmSchemes(server, runtime.networks);

  const researchRoutes: RoutesConfig = {
    [RESEARCH_PATTERN]: {
      accepts: runtime.networks.map((entry) => staticOption(entry, runtime.researchPrice, runtime.maxTimeoutSeconds)),
      description: "SettleKit sample paid research resource",
      mimeType: "application/json",
    },
  };
  app.get("/research", paymentMiddleware(researchRoutes, server), async (c) => {
    const ctx = c.get("ctx");
    await ctx.usage.record(
      { organizationId: runtime.organizationId, customerId: payerOf(c) ?? "x402_agent", productId: "prod_x402_research", metric: "paid_calls" },
      1,
      new Date(),
    );
    return data(c, {
      answer: "Paid research result: SettleKit settles agent payments on Solana, Base, Arbitrum, Ethereum, HyperEVM and Robinhood.",
      generatedAt: new Date().toISOString(),
    });
  });

  const buyServer = new x402HTTPResourceServer(server, {
    [BUY_PATTERN]: {
      accepts: runtime.networks.map((entry) => purchaseOption(entry, runtime.maxTimeoutSeconds)),
      description: "Buy a SettleKit product (settles before delivery)",
      mimeType: "application/json",
    },
  });

  app.post(
    "/products/:productId/buy",
    async (c, next) => {
      try {
        const buyer = await readBuyer(c.req.raw);
        c.set("x402Purchase", await resolvePurchasable(c.get("ctx"), c.req.param("productId"), buyer));
      } catch (err) {
        return error(c, err);
      }
      await next();
    },
    settleFirstPayment(buyServer),
    async (c) => {
      const settled = c.get("x402Settled");
      const purchase = c.get("x402Purchase");
      const entry = runtime.networks.find((candidate) => candidate.caip2 === settled?.requirements.network);
      if (!settled || !purchase || !entry) {
        return c.json({ error: { code: "internal_error", message: "settled payment missing" } }, 500);
      }
      try {
        const result = await fulfilAgentPurchase(c.get("ctx"), {
          product: purchase.product,
          price: purchase.price,
          rail: "x402",
          network: entry.network,
          txHash: settled.settlement.transaction,
          ...(settled.settlement.payer ? { payer: settled.settlement.payer } : {}),
          assetSymbol: entry.symbol,
          buyer: purchase.buyer,
        });
        return data(c, result, 201);
      } catch (err) {
        return fulfilmentError(c, err, {
          rail: "x402",
          network: entry.network,
          txHash: settled.settlement.transaction,
          productId: purchase.product.id,
          ...(settled.settlement.payer ? { payer: settled.settlement.payer } : {}),
        });
      }
    },
  );

  return app;
}
