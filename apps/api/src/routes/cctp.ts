/**
 * CCTP V2 cross-chain pay-in routes — a customer pays USDC on any supported
 * chain and it settles on Arc.
 *
 *   POST /v1/cctp/burn-tx       build the customer's depositForBurn tx (source chain)
 *   GET  /v1/cctp/attestation   poll Circle's Iris attestation for a burn tx
 *   POST /v1/cctp/mint-tx       build the Arc mint tx from an attested message
 *
 * The client is signer-agnostic: these endpoints return unsigned `{to,data,value}`
 * transaction requests. The customer signs+sends the burn on the source chain;
 * a SettleKit relayer sends the mint on Arc once Circle attests the burn. The
 * minted USDC is then confirmed on-chain via `@settlekit/arc`.
 */
import { Hono } from "hono";
import { z } from "zod";
import { toBaseUnits, validationError } from "@settlekit/common";
import { FINALITY_THRESHOLD_FAST, encodeSettleKitHookData, type CctpMessage } from "@settlekit/cctp";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x address");
const txHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x tx hash");
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal amount");

const burnSchema = z.object({
  /** USDC amount (major units, e.g. "25.00"). */
  amount: decimal,
  /** Recipient of the minted USDC on Arc (the SettleKit settlement wallet). */
  mintRecipient: hexAddress,
  /** USDC ERC-20 address on the customer's source chain. */
  burnToken: hexAddress,
  /** TokenMessengerV2 address on the source chain. */
  tokenMessenger: hexAddress,
  /** Destination CCTP domain; defaults to Arc (26). */
  destinationDomain: z.number().int().min(0).optional(),
  /** Restrict who may mint on Arc; omit for "anyone". */
  destinationCaller: hexAddress.optional(),
  /** Max mint fee (major units); defaults to 0 (Standard, no fee). */
  maxFee: decimal.optional(),
  /** Finality threshold; defaults to Standard (1000). Use 500 for Fast. */
  minFinalityThreshold: z.number().int().positive().optional(),
  /**
   * Request a CCTP V2 **Fast Transfer** (settles in seconds via soft finality,
   * vs minutes for Standard). Sets the finality threshold to FAST; pair with a
   * non-zero `maxFee` since Fast Transfers may carry a fee. Ignored when
   * `minFinalityThreshold` is set explicitly.
   */
  fast: z.boolean().optional(),
  /**
   * Optional CCTP V2 hook payload (hex). When present the burn uses
   * `depositForBurnWithHook`, letting custom logic run on the destination chain
   * after mint (e.g. crediting a checkout). Requires a hook handler deployed at
   * the destination — see docs/ARC_CIRCLE_NEXT_PHASE.md.
   */
  hookData: z.string().regex(/^0x[a-fA-F0-9]*$/).optional(),
  /**
   * Convenience: instead of raw `hookData`, target the `SettleKitCctpHook`
   * contract — the API encodes `abi.encode(merchant, orderId)`. Set
   * `mintRecipient` to the deployed hook so the mint settles the order atomically.
   */
  hook: z
    .object({
      merchant: hexAddress,
      /** Arbitrary order ref (e.g. checkout id) or a 0x 32-byte hash. */
      orderId: z.string().min(1),
    })
    .optional(),
});

/** CCTP message echoed back by Iris; passed verbatim to mint-tx. */
const messageSchema = z
  .object({
    message: z.string().regex(/^0x[a-fA-F0-9]*$/),
    eventNonce: z.string(),
    attestation: z.string().nullable(),
    status: z.string(),
  })
  .passthrough();

/** Serialize a tx request's bigint `value` for JSON. */
function serializeTx(tx: { to: string; data: string; value: bigint }): {
  to: string;
  data: string;
  value: string;
} {
  return { to: tx.to, data: tx.data, value: tx.value.toString() };
}

export function cctpRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/burn-tx", async (c) => {
    const body = await parseBody(c, burnSchema);
    const ctx = c.get("ctx");
    const destinationDomain = body.destinationDomain ?? ctx.cctp.domainFor("arc");
    // Explicit threshold wins; otherwise `fast` selects FAST, else client default (Standard).
    const minFinalityThreshold =
      body.minFinalityThreshold ?? (body.fast ? FINALITY_THRESHOLD_FAST : undefined);
    // Raw hookData wins; otherwise encode the SettleKit hook payload from {merchant,orderId}.
    const hookData: `0x${string}` | undefined =
      (body.hookData as `0x${string}` | undefined) ??
      (body.hook
        ? encodeSettleKitHookData({
            merchant: body.hook.merchant as `0x${string}`,
            orderId: body.hook.orderId,
          })
        : undefined);
    const tx = ctx.cctp.buildBurnTx({
      amount: toBaseUnits(body.amount),
      destinationDomain,
      mintRecipient: body.mintRecipient as `0x${string}`,
      burnToken: body.burnToken as `0x${string}`,
      tokenMessenger: body.tokenMessenger as `0x${string}`,
      ...(body.destinationCaller
        ? { destinationCaller: body.destinationCaller as `0x${string}` }
        : {}),
      ...(body.maxFee !== undefined ? { maxFee: toBaseUnits(body.maxFee) } : {}),
      ...(minFinalityThreshold !== undefined ? { minFinalityThreshold } : {}),
      ...(hookData ? { hookData } : {}),
    });
    return created(c, {
      destinationDomain,
      fast: minFinalityThreshold === FINALITY_THRESHOLD_FAST,
      hook: hookData !== undefined,
      tx: serializeTx(tx),
    });
  });

  app.get("/attestation", async (c) => {
    const sourceDomainRaw = c.req.query("sourceDomain");
    const txHash = c.req.query("txHash");
    if (sourceDomainRaw === undefined || txHash === undefined) {
      throw validationError("sourceDomain and txHash query params are required");
    }
    const sourceDomain = Number.parseInt(sourceDomainRaw, 10);
    if (!Number.isInteger(sourceDomain) || sourceDomain < 0) {
      throw validationError("sourceDomain must be a non-negative integer");
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw validationError("txHash must be a 0x transaction hash");
    }
    const message = await c
      .get("ctx")
      .cctp.fetchAttestation(sourceDomain, txHash as `0x${string}`);
    return data(c, { pending: message === null, message });
  });

  app.post("/mint-tx", async (c) => {
    const body = await parseBody(c, messageSchema);
    const tx = c.get("ctx").cctp.buildArcMintTx(body as unknown as CctpMessage);
    return created(c, { tx: serializeTx(tx) });
  });

  return app;
}
