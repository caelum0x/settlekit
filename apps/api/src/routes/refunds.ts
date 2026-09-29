/**
 * Refund routes — the refund engine over the REAL `@settlekit/refunds`
 * `RefundService` (in-memory store on the app context).
 *
 *   POST /v1/refunds                          create a pending refund
 *   GET  /v1/refunds?paymentId=&customerId=    list by payment or customer
 *   POST /v1/refunds/:id/succeed               pending -> succeeded
 *   POST /v1/refunds/:id/fail                  pending -> failed
 *
 * Creation needs the backing Payment: the route looks it up by `paymentId`
 * via the payments repository so the service can validate refundable remaining.
 */
import { Hono } from "hono";
import { z } from "zod";
import { notFound } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";
import { isOwned, ownedPaymentIds, requireOwnedPayment } from "../http/tenant.js";
import type { Context } from "hono";
import type { Refund } from "@settlekit/refunds";

const amount = z.string().regex(/^\d+(\.\d+)?$/);

const reasonSchema = z.enum(["duplicate", "fraudulent", "customer_request", "delivery_failed"]);

const createSchema = z.object({
  paymentId: z.string().min(1),
  customerId: z.string().min(1),
  amount,
  reason: reasonSchema,
  /** Optional hint for the original payment amount; the backing payment is authoritative. */
  originalAmount: amount.optional(),
});

const failSchema = z.object({
  reason: z.string().min(1).optional(),
});

/**
 * Load a refund by id, requiring its payment belongs to the caller's org. A
 * foreign refund answers 404 exactly like a missing one.
 */
async function ownedRefund(c: Context<AppEnv>, id: string): Promise<Refund> {
  const ctx = c.get("ctx");
  const refund = await ctx.refundStore.findById(id);
  if (!refund || !isOwned(c, await ctx.payments.findById(refund.paymentId))) {
    throw notFound("refund not found", { id });
  }
  return refund;
}

export function refundRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, createSchema);
    const ctx = c.get("ctx");
    // Tenant-scoped: only the caller's own payments can be refunded.
    const payment = await requireOwnedPayment(c, body.paymentId);
    const refund = unwrapResult(
      await ctx.refunds.create({
        payment,
        customerId: body.customerId,
        amount: body.amount,
        reason: body.reason,
      }),
    );
    return created(c, refund);
  });

  app.get("/", async (c) => {
    const ctx = c.get("ctx");
    const paymentId = c.req.query("paymentId");
    const customerId = c.req.query("customerId");
    // Tenant-scoped: a refund is visible only when its payment is ours.
    const owned = await ownedPaymentIds(c);
    const all = paymentId
      ? await ctx.refunds.listByPayment(paymentId)
      : customerId
        ? await ctx.refunds.listByCustomer(customerId)
        : await ctx.refundStore.listAll();
    return data(c, all.filter((r) => owned.has(r.paymentId)));
  });

  app.post("/:id/succeed", async (c) => {
    const { id } = await ownedRefund(c, c.req.param("id"));
    const refund = unwrapResult(await c.get("ctx").refunds.markSucceeded(id));
    return data(c, refund);
  });

  app.post("/:id/fail", async (c) => {
    const { id } = await ownedRefund(c, c.req.param("id"));
    const body = await parseBody(c, failSchema);
    const refund = unwrapResult(
      await c.get("ctx").refunds.markFailed(id, body.reason ?? "refund failed"),
    );
    return data(c, refund);
  });

  return app;
}
