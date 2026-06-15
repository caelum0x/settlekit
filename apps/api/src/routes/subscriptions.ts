/**
 * Subscription routes (plan §15).
 *
 * Recurring subscriptions are created from a recurring `Price` via
 * `@settlekit/payments` `createSubscription`, then renewed / canceled with the
 * pure lifecycle transitions. On creation a subscription entitlement is granted
 * for the product via `EntitlementService.grantFromSubscription`.
 */
import { Hono } from "hono";
import { z } from "zod";
import { notFound, validationError } from "@settlekit/common";
import {
  cancelSubscription,
  createSubscription,
  renewSubscription,
} from "@settlekit/payments";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const createSchema = z.object({
  organizationId: z.string().min(1),
  customerId: z.string().min(1),
  productId: z.string().min(1),
  priceId: z.string().min(1),
  cancelAtPeriodEnd: z.boolean().optional(),
});

export function subscriptionRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, createSchema);
    const price = ctx.prices.findById(body.priceId);
    if (!price) throw notFound("price not found", { id: body.priceId });
    if (price.interval === "one_time") {
      throw validationError("subscriptions require a recurring price interval", {
        priceId: price.id,
      });
    }
    const product = ctx.products.findById(body.productId);
    if (!product) throw notFound("product not found", { id: body.productId });

    const subscription = createSubscription({
      organizationId: body.organizationId,
      customerId: body.customerId,
      productId: body.productId,
      price,
      ...(body.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: body.cancelAtPeriodEnd } : {}),
    });
    const saved = await ctx.subscriptions.save(subscription);

    const entitlement = await ctx.entitlements.grantFromSubscription({
      subscription: saved,
      product,
    });
    return created(c, { subscription: saved, entitlement });
  });

  app.get("/:id", async (c) => {
    const sub = await c.get("ctx").subscriptions.findById(c.req.param("id"));
    if (!sub) throw notFound("subscription not found", { id: c.req.param("id") });
    return data(c, sub);
  });

  app.post("/:id/renew", async (c) => {
    const ctx = c.get("ctx");
    const sub = await ctx.subscriptions.findById(c.req.param("id"));
    if (!sub) throw notFound("subscription not found", { id: c.req.param("id") });
    const price = ctx.prices.findById(sub.priceId);
    if (!price) throw notFound("price not found", { id: sub.priceId });
    const interval = price.interval === "yearly" ? "yearly" : "monthly";
    return data(c, await ctx.subscriptions.save(renewSubscription(sub, interval)));
  });

  app.post("/:id/cancel", async (c) => {
    const ctx = c.get("ctx");
    const sub = await ctx.subscriptions.findById(c.req.param("id"));
    if (!sub) throw notFound("subscription not found", { id: c.req.param("id") });
    return data(c, await ctx.subscriptions.save(cancelSubscription(sub)));
  });

  return app;
}
