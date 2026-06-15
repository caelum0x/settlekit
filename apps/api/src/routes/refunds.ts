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

export function refundRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, createSchema);
    const ctx = c.get("ctx");
    const payment = await ctx.payments.findById(body.paymentId);
    if (!payment) {
      throw notFound(`payment ${body.paymentId} not found`);
    }
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
    if (paymentId) {
      return data(c, await ctx.refunds.listByPayment(paymentId));
    }
    if (customerId) {
      return data(c, await ctx.refunds.listByCustomer(customerId));
    }
    return data(c, await ctx.refundStore.listAll());
  });

  app.post("/:id/succeed", async (c) => {
    const refund = unwrapResult(await c.get("ctx").refunds.markSucceeded(c.req.param("id")));
    return data(c, refund);
  });

  app.post("/:id/fail", async (c) => {
    const body = await parseBody(c, failSchema);
    const refund = unwrapResult(
      await c.get("ctx").refunds.markFailed(c.req.param("id"), body.reason ?? "refund failed"),
    );
    return data(c, refund);
  });

  return app;
}
