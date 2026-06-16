/**
 * Circle Gateway / Unified Balance routes — a single spendable USDC balance.
 *
 *   POST /v1/gateway/deposit-tx            build a deposit into the unified balance
 *   GET  /v1/gateway/balance               read a depositor's balance on Arc
 *   POST /v1/gateway/transfer-attestation  attest signed burn intents (spend)
 *   POST /v1/gateway/mint-tx               build the destination mint tx
 *
 * Deposit/mint return unsigned `{to,data,value}` requests for the merchant's
 * wallet to sign. The signable burn intent itself is produced + signed client
 * side (see `@settlekit/gateway`); this API attests the signed intents and
 * builds the resulting mint. Defaults target Arc testnet USDC + Gateway
 * contracts from `@settlekit/arc`.
 */
import { Hono } from "hono";
import { z } from "zod";
import { toBaseUnits, validationError } from "@settlekit/common";
import { ARC_TESTNET } from "@settlekit/arc";
import type { SignedBurnIntent } from "@settlekit/gateway";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x address");
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal amount");

const depositSchema = z.object({
  /** USDC amount in major units (e.g. "100.00"). */
  amount: decimal,
  /** Token to deposit; defaults to Arc testnet USDC. */
  token: hexAddress.optional(),
  /** GatewayWallet; defaults to the Arc testnet GatewayWallet. */
  gatewayWallet: hexAddress.optional(),
});

const mintSchema = z.object({
  gatewayMinter: hexAddress.optional(),
  attestation: z.string().regex(/^0x[a-fA-F0-9]*$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]*$/),
});

const transferSchema = z.object({
  intents: z.array(z.unknown()).min(1),
  enableForwarder: z.boolean().optional(),
});

function serializeTx(tx: { to: string; data: string; value: bigint }) {
  return { to: tx.to, data: tx.data, value: tx.value.toString() };
}

export function gatewayRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/deposit-tx", async (c) => {
    const body = await parseBody(c, depositSchema);
    const tx = c.get("ctx").gateway.buildDeposit({
      gatewayWallet: body.gatewayWallet ?? ARC_TESTNET.contracts.gatewayWallet,
      token: body.token ?? ARC_TESTNET.tokens.USDC.address,
      value: toBaseUnits(body.amount),
    });
    return created(c, { tx: serializeTx(tx) });
  });

  app.get("/balance", async (c) => {
    const depositor = c.req.query("depositor");
    if (depositor === undefined || !/^0x[a-fA-F0-9]{40}$/.test(depositor)) {
      throw validationError("depositor query param (0x address) is required");
    }
    const token = c.req.query("token") ?? ARC_TESTNET.tokens.USDC.address;
    const gatewayWallet = c.req.query("gatewayWallet") ?? ARC_TESTNET.contracts.gatewayWallet;
    const balance = await c.get("ctx").gateway.readChainBalance({
      gatewayWallet,
      token,
      depositor,
    });
    return data(c, {
      total: balance.total.toString(),
      available: balance.available.toString(),
      withdrawing: balance.withdrawing.toString(),
      withdrawable: balance.withdrawable.toString(),
    });
  });

  app.post("/transfer-attestation", async (c) => {
    const body = await parseBody(c, transferSchema);
    const attestation = await c.get("ctx").gateway.requestTransferAttestation(
      body.intents as SignedBurnIntent[],
      body.enableForwarder !== undefined ? { enableForwarder: body.enableForwarder } : undefined,
    );
    return data(c, attestation);
  });

  app.post("/mint-tx", async (c) => {
    const body = await parseBody(c, mintSchema);
    const tx = c.get("ctx").gateway.buildGatewayMint({
      gatewayMinter: body.gatewayMinter ?? ARC_TESTNET.contracts.gatewayMinter,
      attestation: body.attestation as `0x${string}`,
      signature: body.signature as `0x${string}`,
    });
    return created(c, { tx: serializeTx(tx) });
  });

  return app;
}
