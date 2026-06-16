/**
 * StableFX routes — multi-currency (USDC/EURC) FX for checkout pricing.
 *
 *   POST /v1/fx/quote          compute an exact-decimal FX quote from a rate
 *   POST /v1/fx/swap-request   build the on-chain swap request for a quote
 *
 * Quoting is pure 6-decimal integer math (no float drift) so the displayed and
 * settled amounts always agree. Settlement goes through the Arc `FxEscrow`
 * (see `@settlekit/stablefx`); the buyer's transfer is later verified on-chain
 * via `@settlekit/arc`.
 */
import { Hono } from "hono";
import { z } from "zod";
import { computeFxQuote, type FxQuoteInput, type FxSwapRequest } from "@settlekit/stablefx";
import { ARC_TESTNET } from "@settlekit/arc";
import {
  FX_ESCROW_TESTNET,
  PERMIT2_ADDRESS,
  FX_WITNESS_TYPES,
  FX_EIP712_TYPES,
} from "@settlekit/onchain";
import { validationError } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const currency = z.enum(["USDC", "EURC"]);
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal amount");

const amountSchema = z.object({ amount: decimal, currency });

const rateSchema = z.object({
  base: currency,
  quote: currency,
  rate: z.string().regex(/^\d+(\.\d+)?$/),
});

const quoteSchema = z.object({
  sell: amountSchema,
  rate: rateSchema,
  feeRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  rounding: z.enum(["floor", "ceil", "half_even"]).optional(),
});

const swapSchema = quoteSchema.extend({
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x address"),
});

export function fxRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/quote", async (c) => {
    const body = await parseBody(c, quoteSchema);
    return data(c, computeFxQuote(toQuoteInput(body)));
  });

  app.post("/swap-request", async (c) => {
    const body = await parseBody(c, swapSchema);
    const quote = computeFxQuote(toQuoteInput(body));
    const swapRequest: FxSwapRequest = {
      sell: quote.sell,
      buyCurrency: quote.buy.currency,
      recipient: body.recipient as `0x${string}`,
      escrow: ARC_TESTNET.contracts.fxEscrow,
      tenor: "instant",
    };
    return created(c, { quote, swapRequest });
  });

  // --- StableFX RFQ (market-maker FX, settled on Arc FxEscrow) ----------------
  // Cred-gated on CIRCLE_MINT_API_KEY. Schemas mirror Circle's StableFX OpenAPI.
  // The quote returns the EIP-712 `typedData` the taker signs with their wallet;
  // the signed Permit2 message + signature are submitted at trade creation.

  app.post("/rfq/quote", async (c) => {
    const body = await parseBody(c, rfqQuoteSchema);
    const rfq = requireRfq(c);
    return data(
      c,
      await rfq.requestQuote({
        from: body.from,
        to: body.to,
        tenor: body.tenor ?? "instant",
        ...(body.type ? { type: body.type } : {}),
        ...(body.recipientAddress ? { recipientAddress: body.recipientAddress } : {}),
      }),
    );
  });

  app.post("/rfq/trades", async (c) => {
    const body = await parseBody(c, rfqTradeSchema);
    const rfq = requireRfq(c);
    return created(
      c,
      await rfq.createTrade({
        quoteId: body.quoteId,
        address: body.address,
        message: body.message,
        signature: body.signature,
        idempotencyKey: body.idempotencyKey,
      }),
    );
  });

  app.post("/rfq/signatures", async (c) => {
    const body = await parseBody(c, rfqMakerSigSchema);
    const rfq = requireRfq(c);
    return created(
      c,
      await rfq.registerMakerSignature({
        tradeId: body.tradeId,
        address: body.address,
        details: body.details,
        signature: body.signature,
      }),
    );
  });

  app.get("/rfq/trades", async (c) => {
    const rfq = requireRfq(c);
    return data(c, await rfq.listTrades());
  });

  app.get("/rfq/trades/:id", async (c) => {
    const rfq = requireRfq(c);
    return data(c, await rfq.getTrade(c.req.param("id")));
  });

  app.get("/rfq/trades/:id/presign", async (c) => {
    const rfq = requireRfq(c);
    return data(c, await rfq.getPresignData(c.req.param("id")));
  });

  // On-chain settlement spec — the verified Arc FxEscrow address, Permit2, and
  // the EIP-712 witness types (sourced from the verified contract, not guessed).
  // Clients use these to build + sign the Permit2 `PermitWitnessTransferFrom`
  // that funds a StableFX trade.
  app.get("/onchain/info", (c) => {
    return data(c, {
      fxEscrow: FX_ESCROW_TESTNET,
      permit2: PERMIT2_ADDRESS,
      witnessTypes: FX_WITNESS_TYPES,
      eip712Types: FX_EIP712_TYPES,
    });
  });

  return app;
}

const currencyAmount = z.object({ currency, amount: decimal.optional() });

const rfqQuoteSchema = z.object({
  from: currencyAmount,
  to: currencyAmount,
  tenor: z.enum(["instant", "hourly", "daily"]).optional(),
  type: z.enum(["reference", "tradable"]).optional(),
  recipientAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

const rfqTradeSchema = z.object({
  quoteId: z.string().min(1),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** The taker's Permit2 message (from the quote's typedData.message). */
  message: z.unknown(),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  idempotencyKey: z.string().min(1),
});

const rfqMakerSigSchema = z.object({
  tradeId: z.string().min(1),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  details: z.unknown(),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

/** Resolve the RFQ client or throw a clear "not configured" error. */
function requireRfq(c: { get(k: "ctx"): { rfq: import("@settlekit/stablefx").RfqClient | null } }) {
  const rfq = c.get("ctx").rfq;
  if (!rfq) {
    throw validationError("StableFX RFQ is not configured; set CIRCLE_MINT_API_KEY");
  }
  return rfq;
}

/** Build the pure-FX input from a validated request body. */
function toQuoteInput(body: {
  sell: { amount: string; currency: "USDC" | "EURC" };
  rate: { base: "USDC" | "EURC"; quote: "USDC" | "EURC"; rate: string };
  feeRate?: string;
  rounding?: "floor" | "ceil" | "half_even";
}): FxQuoteInput {
  return {
    sell: body.sell,
    rate: body.rate,
    ...(body.feeRate !== undefined ? { feeRate: body.feeRate } : {}),
    ...(body.rounding !== undefined ? { rounding: body.rounding } : {}),
  };
}
