/**
 * On-chain escrow routes — build unsigned transactions for the deployed
 * `SettleKitEscrow` contract (see `/contracts`). The API never signs; it returns
 * `{to,data,value}` requests for the buyer/seller/arbiter wallet to broadcast.
 *
 *   POST /v1/onchain-escrow/fund      createAndFund (+ a USDC approve tx)
 *   POST /v1/onchain-escrow/release   release to seller
 *   POST /v1/onchain-escrow/refund    refund to buyer
 *   POST /v1/onchain-escrow/dispute   raise a dispute
 *
 * Pass the deployed `escrow` contract address per request.
 */
import { Hono } from "hono";
import { z } from "zod";
import { toBaseUnits } from "@settlekit/common";
import { ARC_TESTNET } from "@settlekit/arc";
import {
  buildCreateAndFundTx,
  buildReleaseTx,
  buildRefundTx,
  buildDisputeTx,
  buildErc20ApproveTx,
  type EscrowTxRequest,
} from "@settlekit/onchain";
import type { AppEnv } from "../context.js";
import { created } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x address");
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal amount");

const fundSchema = z.object({
  escrow: hexAddress,
  id: z.string().min(1),
  seller: hexAddress,
  arbiter: hexAddress,
  amount: decimal,
  /** USDC token to fund with; defaults to Arc testnet USDC. */
  token: hexAddress.optional(),
});

const actionSchema = z.object({ escrow: hexAddress, id: z.string().min(1) });

function serialize(req: EscrowTxRequest) {
  return { to: req.to, data: req.data, value: req.value.toString() };
}

export function onchainEscrowRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/fund", async (c) => {
    const body = await parseBody(c, fundSchema);
    const amount = toBaseUnits(body.amount);
    const token = body.token ?? ARC_TESTNET.tokens.USDC.address;
    // The buyer must approve the escrow to pull USDC before createAndFund.
    const approveTx = serialize(buildErc20ApproveTx(token, body.escrow, amount));
    const fundTx = serialize(
      buildCreateAndFundTx(body.escrow, {
        id: body.id,
        seller: body.seller,
        arbiter: body.arbiter,
        amount,
      }),
    );
    return created(c, { approveTx, fundTx });
  });

  app.post("/release", async (c) => {
    const body = await parseBody(c, actionSchema);
    return created(c, { tx: serialize(buildReleaseTx(body.escrow, body.id)) });
  });

  app.post("/refund", async (c) => {
    const body = await parseBody(c, actionSchema);
    return created(c, { tx: serialize(buildRefundTx(body.escrow, body.id)) });
  });

  app.post("/dispute", async (c) => {
    const body = await parseBody(c, actionSchema);
    return created(c, { tx: serialize(buildDisputeTx(body.escrow, body.id)) });
  });

  return app;
}
