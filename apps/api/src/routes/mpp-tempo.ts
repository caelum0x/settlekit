/**
 * Agent payments on Tempo over the Machine Payments Protocol (`mppx`, wevm,
 * MIT). PUBLIC: the payment is the authorization.
 *
 *   GET  /v1/mpp/research                 sample paid resource (mppx/hono middleware)
 *   POST /v1/mpp/products/:productId/buy  buy a product: the mppx charge is verified
 *                                         on-chain first, then the Payment is recorded
 *                                         (unique tx hash), the entitlement granted and
 *                                         delivery run inline; the artifact is returned
 *                                         with the Payment-Receipt header
 *
 * Challenges ride on `WWW-Authenticate: Payment ...`, credentials on
 * `Authorization: Payment ...` (HTTP Payment auth scheme).
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { Credential, Receipt } from "mppx";
import { Mppx as MppxHono } from "mppx/hono";
import { Mppx } from "mppx/server";
import type { AppEnv } from "../context.js";
import type { AgentPaymentsRuntime } from "../agent-payments/config.js";
import type { MppRuntime } from "../agent-payments/mpp.js";
import { fulfilAgentPurchase } from "../agent-payments/fulfil.js";
import { fulfilmentError } from "../agent-payments/unfulfilled.js";
import { readBuyer, resolvePurchasable } from "../agent-payments/purchasable.js";
import { data, error } from "../http/respond.js";

const CHARGE_KEY = "tempo/charge";

/** `did:pkh:eip155:<chain>:<address>` -> address, when the credential names its payer. */
function payerFromCredential(request: Request): string | undefined {
  try {
    const source = Credential.fromRequest(request).source;
    const match = source ? /^did:pkh:eip155:\d+:(0x[0-9a-fA-F]{40})$/.exec(source) : null;
    return match?.[1];
  } catch {
    return undefined;
  }
}

function unavailable(c: Context): Response {
  return c.json(
    { error: { code: "mpp_unavailable", message: "MPP on Tempo is not configured (set MPP_SECRET_KEY and MPP_TEMPO_RECIPIENT)" } },
    503,
  );
}

type ChargeFn = (options: Record<string, unknown>) => (request: Request) => Promise<
  { status: 402; challenge: Response } | { status: 200; withReceipt: (response?: Response) => Response }
>;

function chargeOf(instance: unknown): ChargeFn | undefined {
  return (instance as Record<string, ChargeFn | undefined>)[CHARGE_KEY];
}

/** Mount under `/v1/mpp`. */
export function mppTempoRoutes(runtime: AgentPaymentsRuntime | null): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const mpp: MppRuntime | null = runtime?.mpp ?? null;
  if (!mpp) {
    app.all("*", unavailable);
    return app;
  }

  const config = { methods: [mpp.charge], secretKey: mpp.secretKey, realm: mpp.realm };
  const core = Mppx.create(config);
  const buyCharge = chargeOf(core);
  if (!buyCharge) throw new Error("mppx did not expose the tempo/charge intent on the server instance");
  const honoMppx = MppxHono.create(config);
  const researchCharge = (honoMppx as unknown as Record<string, (options: Record<string, unknown>) => MiddlewareHandler>)[CHARGE_KEY];
  if (!researchCharge) throw new Error("mppx did not expose the tempo/charge intent");

  app.get("/research", researchCharge({ amount: runtime?.researchPrice ?? "0.01", description: "SettleKit sample paid research resource" }), (c) =>
    data(c, {
      answer: "Paid research result: settled on Tempo through the Machine Payments Protocol.",
      generatedAt: new Date().toISOString(),
    }),
  );

  app.post("/products/:productId/buy", async (c) => {
    try {
      const ctx = c.get("ctx");
      const buyer = await readBuyer(c.req.raw);
      const purchase = await resolvePurchasable(ctx, c.req.param("productId"), buyer);
      const result = await buyCharge({
        amount: purchase.price.amount,
        description: `SettleKit: ${purchase.product.name}`,
        externalId: purchase.product.id,
      })(c.req.raw);
      if (result.status === 402) return result.challenge;

      const receipt = Receipt.fromResponse(result.withReceipt(new Response(null)));
      const payer = payerFromCredential(c.req.raw);
      try {
        const outcome = await fulfilAgentPurchase(ctx, {
          product: purchase.product,
          price: purchase.price,
          rail: "mpp",
          network: "tempo",
          txHash: receipt.reference,
          ...(payer ? { payer } : {}),
          assetSymbol: mpp.symbol,
          buyer: purchase.buyer,
        });
        return result.withReceipt(data(c, outcome, 201));
      } catch (err) {
        return result.withReceipt(
          fulfilmentError(c, err, {
            rail: "mpp",
            network: "tempo",
            txHash: receipt.reference,
            productId: purchase.product.id,
            ...(payer ? { payer } : {}),
          }),
        );
      }
    } catch (err) {
      return error(c, err);
    }
  });

  return app;
}
