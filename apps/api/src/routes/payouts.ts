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
import { conflict, notFound, validationError } from "@settlekit/common";
import { computePlatformRevenue, totalPlatformFees } from "@settlekit/platform-billing";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";
import { requireOrg } from "../http/tenant.js";
import { screenAddressOrThrow } from "../compliance/screen.js";

const amount = z.string().regex(/^\d+(\.\d+)?$/);

const networkSchema = z.enum(["arc", "base", "ethereum"]);

const createSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
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
    // Tenant-scoped: payouts settle the authenticated org's balance.
    const organizationId = requireOrg(c);
    const payments = await ctx.payments.findConfirmedByOrganization(organizationId);
    // The platform take-rate is reserved before the merchant can withdraw: the
    // available balance is net of fees, so a payout can't draw down SettleKit's cut.
    const platformFees = totalPlatformFees(payments, ctx.platformFeeSchedule);
    const payout = unwrapResult(
      await ctx.payouts.create({
        organizationId,
        walletAddress: body.walletAddress,
        amount: body.amount,
        network: body.network,
        payments,
        platformFees,
      }),
    );
    return created(c, payout);
  });

  app.get("/", async (c) => {
    // Tenant-scoped: only the authenticated organization's payouts.
    const ctx = c.get("ctx");
    return data(c, await ctx.payouts.listByOrganization(requireOrg(c)));
  });

  app.get("/balance", async (c) => {
    // Tenant-scoped: balance for the authenticated organization, with the full
    // take-rate breakdown so the merchant sees gross, the platform fee, and the
    // net they can withdraw. `available` is net-of-fees minus prior payouts.
    const organizationId = requireOrg(c);
    const ctx = c.get("ctx");
    const payments = await ctx.payments.findConfirmedByOrganization(organizationId);
    const revenue = computePlatformRevenue(payments, ctx.platformFeeSchedule);
    const available = await ctx.payouts.availableBalance(organizationId, payments, revenue.platformFees);
    return data(c, {
      available,
      grossVolume: revenue.grossVolume,
      platformFees: revenue.platformFees,
      netToMerchant: revenue.netToMerchant,
      feeSchedule: revenue.schedule,
    });
  });

  // Execute a pending payout for real: move USDC from the SettleKit treasury
  // wallet to the merchant via the configured executor (Circle wallets). When
  // the transfer broadcasts synchronously with a txHash the payout is marked
  // paid; otherwise it stays pending and the provider reference is returned for
  // reconciliation (poll the provider / settle later via /paid).
  app.post("/:id/execute", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    if (!ctx.payoutExecutor) {
      throw validationError(
        "payout execution is not configured; set CIRCLE_WALLETS_* or settle manually via /paid",
        { id },
      );
    }
    const payout = await ctx.payoutStore.findById(id);
    if (!payout) throw notFound("payout not found", { id });
    if (payout.status !== "pending") {
      throw conflict(`payout is ${payout.status}, only pending payouts can be executed`, { id });
    }

    // Compliance gate: screen the destination address before moving funds.
    // No-op when screening is unconfigured; throws compliance_blocked on a hit.
    await screenAddressOrThrow(
      { screening: ctx.screening, defaultChain: ctx.complianceDefaultChain },
      { address: payout.walletAddress, network: payout.network, context: `payout:${id}` },
    );

    const execution = await ctx.payoutExecutor.execute({
      walletAddress: payout.walletAddress,
      amount: payout.amount,
      network: payout.network,
      refId: payout.id,
    });

    // Persist the provider reference so an async settlement can be reconciled
    // later (worker or POST /:id/reconcile).
    await ctx.payoutStore.save({ ...payout, providerRef: execution.providerRef });

    const settled = execution.txHash
      ? unwrapResult(await ctx.payouts.markPaid(id, execution.txHash))
      : await ctx.payoutStore.findById(id);
    return data(c, { payout: settled, execution });
  });

  // Reconcile an executed-but-unsettled payout: re-poll the provider for the
  // on-chain hash and mark paid (or failed) accordingly.
  app.post("/:id/reconcile", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    if (!ctx.payoutExecutor) {
      throw validationError("payout execution is not configured", { id });
    }
    const payout = await ctx.payoutStore.findById(id);
    if (!payout) throw notFound("payout not found", { id });
    if (!payout.providerRef) {
      throw conflict("payout has not been executed; nothing to reconcile", { id });
    }
    if (payout.status !== "pending") {
      return data(c, { payout, execution: { providerRef: payout.providerRef, state: "settled" } });
    }

    const execution = await ctx.payoutExecutor.reconcile(payout.providerRef);
    const FAILED_STATES = new Set(["FAILED", "CANCELLED", "DENIED"]);
    let result = payout;
    if (execution.txHash) {
      result = unwrapResult(await ctx.payouts.markPaid(id, execution.txHash));
    } else if (FAILED_STATES.has(execution.state)) {
      result = unwrapResult(
        await ctx.payouts.markFailed(id, `provider transfer ${execution.state.toLowerCase()}`),
      );
    }
    return data(c, { payout: result, execution });
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
