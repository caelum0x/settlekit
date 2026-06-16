/**
 * Circle user-controlled wallets — customer self-custody (PIN-gated).
 *
 *   POST /v1/user-wallets/users                        create a user
 *   POST /v1/user-wallets/token                         mint a user token
 *   POST /v1/user-wallets/initialize                    PIN + first-wallet challenge
 *   POST /v1/user-wallets/wallets                        create-wallet challenge
 *   POST /v1/user-wallets/transfers                      transfer challenge
 *   GET  /v1/user-wallets/wallets?userToken=             list a user's wallets
 *
 * Sensitive operations return a `challengeId` the customer completes with the
 * client-side Circle SDK (PIN entry); the backend never holds key material.
 * Cred-gated on `CIRCLE_WALLETS_API_KEY`.
 */
import { Hono } from "hono";
import { z } from "zod";
import { validationError } from "@settlekit/common";
import type { UserWalletsClient } from "@settlekit/circle-wallets";
import type { AppEnv, AppContext } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const blockchains = z.array(z.string().min(1)).min(1);
const userToken = z.string().min(1);

const createUserSchema = z.object({ userId: z.string().min(1) });
const tokenSchema = z.object({ userId: z.string().min(1) });
const walletChallengeSchema = z.object({
  userToken,
  blockchains,
  accountType: z.enum(["EOA", "SCA"]).optional(),
});
const transferSchema = z.object({
  userToken,
  walletId: z.string().min(1),
  destinationAddress: z.string().min(1),
  tokenId: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  feeLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  refId: z.string().optional(),
});

function requireClient(ctx: AppContext): UserWalletsClient {
  if (!ctx.userWallets) {
    throw validationError("user-controlled wallets are not configured; set CIRCLE_WALLETS_API_KEY");
  }
  return ctx.userWallets;
}

export function userWalletRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/users", async (c) => {
    const body = await parseBody(c, createUserSchema);
    return created(c, await requireClient(c.get("ctx")).createUser(body.userId));
  });

  app.post("/token", async (c) => {
    const body = await parseBody(c, tokenSchema);
    return created(c, await requireClient(c.get("ctx")).createUserToken(body.userId));
  });

  app.post("/initialize", async (c) => {
    const body = await parseBody(c, walletChallengeSchema);
    const client = requireClient(c.get("ctx"));
    return created(
      c,
      await client.initializeUser(body.userToken, {
        blockchains: body.blockchains as never,
        ...(body.accountType ? { accountType: body.accountType } : {}),
      }),
    );
  });

  app.post("/wallets", async (c) => {
    const body = await parseBody(c, walletChallengeSchema);
    const client = requireClient(c.get("ctx"));
    return created(
      c,
      await client.createWalletChallenge(body.userToken, {
        blockchains: body.blockchains as never,
        ...(body.accountType ? { accountType: body.accountType } : {}),
      }),
    );
  });

  app.post("/transfers", async (c) => {
    const body = await parseBody(c, transferSchema);
    const client = requireClient(c.get("ctx"));
    return created(
      c,
      await client.createTransferChallenge(body.userToken, {
        walletId: body.walletId,
        destinationAddress: body.destinationAddress,
        tokenId: body.tokenId,
        amount: body.amount,
        ...(body.feeLevel ? { feeLevel: body.feeLevel } : {}),
        ...(body.refId ? { refId: body.refId } : {}),
      }),
    );
  });

  app.get("/wallets", async (c) => {
    const token = c.req.query("userToken");
    if (!token) throw validationError("userToken query param is required");
    return data(c, await requireClient(c.get("ctx")).listWallets(token));
  });

  return app;
}
