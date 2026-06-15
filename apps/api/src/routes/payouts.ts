/**
 * Payout routes — the merchant-settlement engine over the REAL
 * `@settlekit/payouts` `PayoutService` (in-memory store on the app context).
 *
 *   POST /v1/payouts                          create a pending payout
 *   GET  /v1/payouts?organizationId=           list payouts for an organization
 *   POST /v1/payouts/:id/paid                  mark paid with an on-chain txHash
 *   POST /v1/payouts/:id/fail                  mark failed
 *   GET  /v1/payouts/balance?organizationId=   available balance for an org
 *
 * Available balance is computed from the organization's confirmed payments
 * (via `PaymentRepository.findConfirmedByOrganization`) minus prior (pending or
 * paid) payouts.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";

const amount = z.string().regex(/^\d+(\.\d+)?$/);

const networkSchema = z.enum(["arc", "base", "ethereum"]);

const createSchema = z.object({
  organizationId: z.string().min(1),
  walletAddress: z.string().min(1),
  amount,
  network: networkSchema,
});

const paidSchema = z.object({
  txHash: z.string().min(1),
});

const failSchema = z.object({
  reason: z.string().min(1).optional(),
});

export function payoutRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, createSchema);
    const ctx = c.get("ctx");
    const payments = await ctx.payments.findConfirmedByOrganization(body.organizationId);
    const payout = unwrapResult(
      await ctx.payouts.create({
        organizationId: body.organizationId,
        walletAddress: body.walletAddress,
        amount: body.amount,
        network: body.network,
        payments,
      }),
    );
    return created(c, payout);
  });

  app.get("/", async (c) => {
    const organizationId = c.req.query("organizationId");
    const ctx = c.get("ctx");
    if (organizationId) {
      return data(c, await ctx.payouts.listByOrganization(organizationId));
    }
    return data(c, await ctx.payoutStore.listAll());
  });

  app.get("/balance", async (c) => {
    const organizationId = c.req.query("organizationId") ?? "";
    const ctx = c.get("ctx");
    const payments = await ctx.payments.findConfirmedByOrganization(organizationId);
    const balance = await ctx.payouts.availableBalance(organizationId, payments);
    return data(c, balance);
  });

  app.post("/:id/paid", async (c) => {
    const body = await parseBody(c, paidSchema);
    const payout = unwrapResult(await c.get("ctx").payouts.markPaid(c.req.param("id"), body.txHash));
    return data(c, payout);
  });

  app.post("/:id/fail", async (c) => {
    const body = await parseBody(c, failSchema);
    const payout = unwrapResult(
      await c.get("ctx").payouts.markFailed(c.req.param("id"), body.reason ?? "payout failed"),
    );
    return data(c, payout);
  });

  return app;
}
