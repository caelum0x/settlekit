/**
 * Circle Mint routes — mint/redeem USDC & EURC against fiat (treasury top-up /
 * off-ramp). Requires `CIRCLE_MINT_API_KEY`; without it these endpoints return
 * a clear "not configured" error.
 *
 *   POST /v1/mint                 mint stablecoin to a verified blockchain address
 *   GET  /v1/mint/:id             mint status
 *   POST /v1/mint/redeem          redeem stablecoin to fiat (wire)
 *   GET  /v1/mint/redeem/:id      redeem status
 */
import { Hono } from "hono";
import { z } from "zod";
import { validationError } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const currency = z.enum(["USDC", "EURC"]);
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal amount");

const mintSchema = z.object({
  amount: decimal,
  currency,
  /** Pre-registered Circle "verified blockchain" address id to deliver to. */
  destinationAddressId: z.string().min(1),
});

const redeemSchema = z.object({
  amount: decimal,
  currency,
  /** Pre-registered Circle wire bank-account id to pay out to. */
  bankAccountId: z.string().min(1),
});

function notConfigured() {
  return validationError("Circle Mint is not configured; set CIRCLE_MINT_API_KEY");
}

export function mintRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/redeem", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.mint) throw notConfigured();
    const body = await parseBody(c, redeemSchema);
    return created(
      c,
      await ctx.mint.createRedeem({
        amount: body.amount,
        currency: body.currency,
        bankAccountId: body.bankAccountId,
      }),
    );
  });

  app.get("/redeem/:id", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.mint) throw notConfigured();
    return data(c, await ctx.mint.getRedeem(c.req.param("id")));
  });

  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.mint) throw notConfigured();
    const body = await parseBody(c, mintSchema);
    return created(
      c,
      await ctx.mint.createMint({
        amount: body.amount,
        currency: body.currency,
        destinationAddressId: body.destinationAddressId,
      }),
    );
  });

  app.get("/:id", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.mint) throw notConfigured();
    return data(c, await ctx.mint.getMint(c.req.param("id")));
  });

  return app;
}
