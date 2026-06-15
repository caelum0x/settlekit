/**
 * Checkout session routes (plan §15, Phase 1).
 *
 * Uses the real `@settlekit/payments` checkout domain: it resolves each line
 * item's `Price` from the price store, computes the total via
 * `createCheckoutSession`, and persists through the in-memory checkout repo.
 * Buyer delivery fields can be merged with `collectFields`; sessions can be
 * canceled/expired through the pure transition functions.
 */
import { Hono } from "hono";
import { z } from "zod";
import { notFound, validationError, type PaymentNetwork } from "@settlekit/common";
import {
  cancelSession,
  collectFields,
  createCheckoutSession,
  expireSession,
  type PricedLineItem,
} from "@settlekit/payments";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const NETWORKS = ["arc", "base", "ethereum"] as const;

const lineItemSchema = z.object({
  priceId: z.string().min(1),
  productId: z.string().optional(),
  bundleId: z.string().optional(),
  quantity: z.number().int().positive().default(1),
});

const createSchema = z.object({
  organizationId: z.string().min(1),
  merchantId: z.string().min(1),
  customerId: z.string().optional(),
  items: z.array(lineItemSchema).min(1),
  payToAddress: z.string().min(1),
  network: z.enum(NETWORKS),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  collectedFields: z.record(z.string()).optional(),
  ttlDays: z.number().int().positive().optional(),
});

const collectSchema = z.object({
  fields: z.record(z.string()),
});

export function checkoutRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, createSchema);

    // Resolve each line item's Price from the price store for total math.
    const priced: PricedLineItem[] = body.items.map((item) => {
      const price = ctx.prices.findById(item.priceId);
      if (!price) {
        throw validationError(`price not found: ${item.priceId}`, { priceId: item.priceId });
      }
      return {
        lineItem: {
          priceId: item.priceId,
          quantity: item.quantity,
          ...(item.productId !== undefined ? { productId: item.productId } : {}),
          ...(item.bundleId !== undefined ? { bundleId: item.bundleId } : {}),
        },
        price,
      };
    });

    const session = createCheckoutSession({
      organizationId: body.organizationId,
      merchantId: body.merchantId,
      ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
      items: priced,
      payToAddress: body.payToAddress,
      network: body.network as PaymentNetwork,
      ...(body.successUrl !== undefined ? { successUrl: body.successUrl } : {}),
      ...(body.cancelUrl !== undefined ? { cancelUrl: body.cancelUrl } : {}),
      ...(body.collectedFields !== undefined ? { collectedFields: body.collectedFields } : {}),
      ...(body.ttlDays !== undefined ? { ttlDays: body.ttlDays } : {}),
    });

    const saved = await ctx.checkouts.save(session);
    return created(c, saved);
  });

  app.get("/:id", async (c) => {
    const session = await c.get("ctx").checkouts.findById(c.req.param("id"));
    if (!session) throw notFound("checkout session not found", { id: c.req.param("id") });
    return data(c, session);
  });

  // Merge buyer-supplied delivery fields into an open session.
  app.post("/:id/collect-fields", async (c) => {
    const ctx = c.get("ctx");
    const session = await ctx.checkouts.findById(c.req.param("id"));
    if (!session) throw notFound("checkout session not found", { id: c.req.param("id") });
    const body = await parseBody(c, collectSchema);
    const updated = await ctx.checkouts.save(collectFields(session, body.fields));
    return data(c, updated);
  });

  app.post("/:id/cancel", async (c) => {
    const ctx = c.get("ctx");
    const session = await ctx.checkouts.findById(c.req.param("id"));
    if (!session) throw notFound("checkout session not found", { id: c.req.param("id") });
    return data(c, await ctx.checkouts.save(cancelSession(session)));
  });

  app.post("/:id/expire", async (c) => {
    const ctx = c.get("ctx");
    const session = await ctx.checkouts.findById(c.req.param("id"));
    if (!session) throw notFound("checkout session not found", { id: c.req.param("id") });
    return data(c, await ctx.checkouts.save(expireSession(session)));
  });

  return app;
}
