/**
 * SaaS routes (plan §26, §20).
 *
 * Plans, feature-bearing tenant entitlements, feature verification, and seat
 * add/remove — all backed by the REAL `@settlekit/saas` `SaasService` over its
 * in-memory plan + seat stores.
 *
 *   POST/GET /v1/saas/plans
 *   POST     /v1/saas/features            — grant a tenant entitlement from a plan
 *   POST     /v1/saas/entitlements/verify — check a feature flag/limit
 *   POST     /v1/saas/seats               — assign a seat
 *   POST     /v1/saas/seats/remove        — release a seat
 */
import { Hono } from "hono";
import { z } from "zod";
import { money } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";
import { requireOrg } from "../http/tenant.js";

const createPlanSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  interval: z.enum(["monthly", "yearly"]).default("monthly"),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  features: z.record(z.union([z.boolean(), z.number()])).default({}),
  seats: z.number().int().nonnegative().default(1),
});

const grantSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  customerId: z.string().min(1),
  planId: z.string().min(1),
  grantedById: z.string().min(1),
  grantedByType: z.enum(["payment", "subscription", "bundle", "manual"]).default("subscription"),
  expiresAt: z.string().datetime().optional(),
});

const verifySchema = z.object({
  planId: z.string().min(1),
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  customerId: z.string().min(1),
  grantedById: z.string().min(1),
  feature: z.string().min(1),
});

const seatSchema = z.object({
  customerId: z.string().min(1),
  userId: z.string().min(1),
  planId: z.string().min(1),
});

const removeSeatSchema = z.object({
  customerId: z.string().min(1),
  userId: z.string().min(1),
});

export function saasRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/plans", async (c) => {
    const body = await parseBody(c, createPlanSchema);
    const plan = unwrapResult(
      await c.get("ctx").saas.createPlan({
        productId: body.productId,
        name: body.name,
        interval: body.interval,
        price: money(body.amount),
        features: body.features,
        seats: body.seats,
      }),
    );
    return created(c, plan);
  });

  app.get("/plans", async (c) => {
    const productId = c.req.query("productId");
    const plans = await c.get("ctx").saas.listPlans(
      productId ? { productId } : {},
    );
    return data(c, plans);
  });

  // List the distinct features across all plans (flattened plan × feature).
  app.get("/features", async (c) => {
    const productId = c.req.query("productId");
    const plans = await c.get("ctx").saas.listPlans(productId ? { productId } : {});
    const features = plans.flatMap((plan) =>
      Object.entries(plan.features).map(([key, value]) => ({
        planId: plan.id,
        planName: plan.name,
        feature: key,
        kind: typeof value === "boolean" ? "flag" : "limit",
        value,
      })),
    );
    return data(c, features);
  });

  // List a customer's seats (requires ?customerId).
  app.get("/seats", async (c) => {
    const customerId = c.req.query("customerId");
    if (!customerId) return data(c, []);
    return data(c, await c.get("ctx").saas.listSeats(customerId));
  });

  // Grant a feature-bearing tenant entitlement from a plan.
  app.post("/features", async (c) => {
    const body = await parseBody(c, grantSchema);
    const entitlement = unwrapResult(
      await c.get("ctx").saas.grantEntitlement({
        organizationId: requireOrg(c),
        customerId: body.customerId,
        planId: body.planId,
        grantedBy: { type: body.grantedByType, id: body.grantedById },
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      }),
    );
    return created(c, entitlement);
  });

  // Verify a feature flag/limit on a freshly-built tenant entitlement.
  app.post("/entitlements/verify", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, verifySchema);
    const entitlement = unwrapResult(
      await ctx.saas.grantEntitlement({
        organizationId: requireOrg(c),
        customerId: body.customerId,
        planId: body.planId,
        grantedBy: { type: "subscription", id: body.grantedById },
      }),
    );
    return data(c, {
      feature: body.feature,
      enabled: ctx.saas.featureEnabled(entitlement, body.feature),
      limit: ctx.saas.featureLimit(entitlement, body.feature) ?? null,
    });
  });

  app.post("/seats", async (c) => {
    const body = await parseBody(c, seatSchema);
    const seats = unwrapResult(
      await c.get("ctx").saas.addSeat(body.customerId, body.userId, body.planId),
    );
    return created(c, { seats });
  });

  app.post("/seats/remove", async (c) => {
    const body = await parseBody(c, removeSeatSchema);
    const seats = unwrapResult(
      await c.get("ctx").saas.removeSeat(body.customerId, body.userId),
    );
    return data(c, { seats });
  });

  return app;
}
