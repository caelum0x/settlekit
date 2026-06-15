/**
 * Payment routes (plan §15, §14).
 *
 * The core money + access flow:
 *   1. POST /v1/payments           — record a pending payment for a session.
 *   2. POST /v1/payments/:id/confirm — confirm it (>= min confirmations). On
 *      confirmation the checkout session is completed and an entitlement is
 *      granted for each line item's product via `EntitlementService.grantFromPayment`.
 *   3. POST /v1/payments/:id/refund  — refund a confirmed payment.
 *
 * Every transition uses the real `@settlekit/payments` lifecycle functions and
 * persists through the in-memory repositories.
 */
import { Hono } from "hono";
import { z } from "zod";
import { conflict, notFound, validationError, type Entitlement } from "@settlekit/common";
import {
  confirmPayment,
  failPayment,
  recordPendingPayment,
  refundPayment,
} from "@settlekit/payments";
import { completeSession } from "@settlekit/payments";
import type { AppEnv, AppContext } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const recordSchema = z.object({
  checkoutSessionId: z.string().min(1),
  txHash: z.string().optional(),
});

const confirmSchema = z.object({
  txHash: z.string().min(1),
  confirmations: z.number().int().nonnegative(),
  minConfirmations: z.number().int().positive().optional(),
});

export function paymentRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Record a pending payment against a checkout session.
  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, recordSchema);
    const session = await ctx.checkouts.findById(body.checkoutSessionId);
    if (!session) throw notFound("checkout session not found", { id: body.checkoutSessionId });
    if (session.customerId === undefined) {
      throw validationError("checkout session has no customer; set customerId before paying", {
        sessionId: session.id,
      });
    }

    const payment = recordPendingPayment({
      organizationId: session.organizationId,
      checkoutSessionId: session.id,
      customerId: session.customerId,
      amount: session.amount,
      network: session.network,
      ...(body.txHash !== undefined ? { txHash: body.txHash } : {}),
    });
    return created(c, await ctx.payments.save(payment));
  });

  app.get("/:id", async (c) => {
    const payment = await c.get("ctx").payments.findById(c.req.param("id"));
    if (!payment) throw notFound("payment not found", { id: c.req.param("id") });
    return data(c, payment);
  });

  // Confirm a payment: completes the session and grants entitlements.
  app.post("/:id/confirm", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const payment = await ctx.payments.findById(id);
    if (!payment) throw notFound("payment not found", { id });

    const body = await parseBody(c, confirmSchema);
    const confirmed = confirmPayment(
      payment,
      body.txHash,
      body.confirmations,
      body.minConfirmations,
    );
    const savedPayment = await ctx.payments.save(confirmed);

    // Complete the session (idempotent) and grant entitlements for each product.
    const session = await ctx.checkouts.findById(payment.checkoutSessionId);
    if (!session) throw conflict("checkout session vanished", { id: payment.checkoutSessionId });
    if (session.status === "open") {
      await ctx.checkouts.save(completeSession(session));
    }

    const entitlements = await grantEntitlements(ctx, savedPayment.id);
    return data(c, { payment: savedPayment, entitlements });
  });

  // Fail a pending payment.
  app.post("/:id/fail", async (c) => {
    const ctx = c.get("ctx");
    const payment = await ctx.payments.findById(c.req.param("id"));
    if (!payment) throw notFound("payment not found", { id: c.req.param("id") });
    return data(c, await ctx.payments.save(failPayment(payment)));
  });

  // Refund a confirmed payment.
  app.post("/:id/refund", async (c) => {
    const ctx = c.get("ctx");
    const payment = await ctx.payments.findById(c.req.param("id"));
    if (!payment) throw notFound("payment not found", { id: c.req.param("id") });
    return data(c, await ctx.payments.save(refundPayment(payment)));
  });

  return app;
}

/**
 * Grant one entitlement per line-item product on a confirmed payment. Resolves
 * the product for each item from the product store and delegates to the real
 * `EntitlementService.grantFromPayment`.
 */
async function grantEntitlements(ctx: AppContext, paymentId: string): Promise<Entitlement[]> {
  const payment = await ctx.payments.findById(paymentId);
  if (!payment) return [];
  const session = await ctx.checkouts.findById(payment.checkoutSessionId);
  if (!session) return [];

  const granted: Entitlement[] = [];
  for (const item of session.lineItems) {
    if (item.productId === undefined) continue;
    const product = await ctx.products.findById(item.productId);
    if (!product) continue;
    const price = await ctx.prices.findById(item.priceId);
    const entitlement = await ctx.entitlements.grantFromPayment({
      payment,
      product,
      ...(price?.creditsGranted !== undefined ? { creditsRemaining: price.creditsGranted } : {}),
    });
    granted.push(entitlement);
  }
  return granted;
}
