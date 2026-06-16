/**
 * Arc network routes — expose the full Arc settlement client.
 *
 *   GET  /v1/arc/info           chain id, RPC, explorer, faucet, tokens, contracts
 *   POST /v1/arc/fee-estimate   estimate a transfer fee (USDC-denominated)
 *   POST /v1/arc/verify         verify a stablecoin transfer on-chain
 *
 * `/info` is static (the bundled chain config). `/fee-estimate` and `/verify`
 * read on-chain and require Arc to be configured (`ARC_CHAIN_ID`); without it
 * they return a clear "not configured" error.
 */
import { Hono } from "hono";
import { z } from "zod";
import { money, validationError, type Money } from "@settlekit/common";
import { ARC_TESTNET, getArcChain, isArcAsset } from "@settlekit/arc";
import type { AppEnv } from "../context.js";
import { data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const asset = z.enum(["USDC", "EURC", "USYC"]);
const txHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be a 0x tx hash");
const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x address");
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal amount");

const feeSchema = z.object({
  /** Optional gas-limit override; defaults to a standard ERC-20 transfer. */
  gasLimit: z.string().regex(/^\d+$/).optional(),
});

const verifySchema = z.object({
  txHash: txHashSchema,
  to: hexAddress,
  minAmount: decimal,
  asset: asset.default("USDC"),
});

function notConfigured() {
  return validationError("Arc is not configured; set ARC_CHAIN_ID (e.g. 5042002 for testnet)");
}

export function arcRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/info", async (c) => {
    const chainId = c.get("ctx").arc?.config.chainId;
    const chain = (chainId !== undefined ? getArcChain(chainId) : undefined) ?? ARC_TESTNET;
    return data(c, {
      name: chain.name,
      chainId: chain.chainId,
      network: chain.network,
      explorerUrl: chain.explorerUrl,
      faucetUrl: chain.faucetUrl,
      cctpDomain: chain.cctpDomain,
      nativeGasAsset: chain.nativeGasAsset,
      tokens: chain.tokens,
      contracts: chain.contracts,
      configured: c.get("ctx").arc !== null,
    });
  });

  app.post("/fee-estimate", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.arc) throw notConfigured();
    const body = await parseBody(c, feeSchema);
    const estimate = await ctx.arc.estimateTransferFee(
      body.gasLimit !== undefined ? { gasLimit: BigInt(body.gasLimit) } : {},
    );
    return data(c, {
      gasLimit: estimate.gasLimit.toString(),
      maxFeePerGas: estimate.maxFeePerGas.toString(),
      maxPriorityFeePerGas: estimate.maxPriorityFeePerGas.toString(),
      feeWei: estimate.feeWei.toString(),
      fee: estimate.fee,
    });
  });

  app.post("/verify", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.arc) throw notConfigured();
    const body = await parseBody(c, verifySchema);
    // `money()`'s currency type is USDC-only, but the Arc verifier handles other
    // stablecoins at runtime — validate the amount, then attach the real asset.
    const minAmount = {
      amount: money(body.minAmount).amount,
      currency: body.asset,
    } as unknown as Money;

    let result;
    if (body.asset === "USDC") {
      result = await ctx.arc.verifyUsdcTransfer({
        txHash: body.txHash as `0x${string}`,
        to: body.to as `0x${string}`,
        minAmount,
      });
    } else {
      const chain = getArcChain(ctx.arc.config.chainId) ?? ARC_TESTNET;
      if (!isArcAsset(body.asset) || !chain.tokens[body.asset]) {
        throw validationError(`unsupported asset on Arc chain ${ctx.arc.config.chainId}: ${body.asset}`);
      }
      result = await ctx.arc.verifyTokenTransfer({
        txHash: body.txHash as `0x${string}`,
        token: chain.tokens[body.asset].address,
        to: body.to as `0x${string}`,
        minAmount,
      });
    }
    return data(c, result);
  });

  return app;
}
