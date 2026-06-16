/**
 * Bundle routes (plan §26, §17).
 *
 * Create / list / get / patch / publish bundles via the REAL `@settlekit/bundles`
 * `BundleService` over its in-memory store. Validation (non-empty, no dup/cycle,
 * all products exist) runs inside the service against the product store.
 *
 *   POST/GET   /v1/bundles
 *   GET/PATCH  /v1/bundles/:id
 *   POST       /v1/bundles/:id/publish
 */
import { Hono } from "hono";
import { z } from "zod";
import { money, type Money } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { unwrapResult } from "../http/internal.js";
import { requireOrg } from "../http/tenant.js";

const createSchema = z.object({
  merchantId: z.string().min(1),
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  productIds: z.array(z.string().min(1)).min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  interval: z.enum(["one_time", "monthly", "yearly"]).optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

export function bundleRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const body = await parseBody(c, createSchema);
    const price: Money | undefined = body.amount ? money(body.amount) : undefined;
    const bundle = unwrapResult(
      await c.get("ctx").bundles.createBundle({
        merchantId: body.merchantId,
        organizationId: requireOrg(c),
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        productIds: body.productIds,
        ...(price !== undefined ? { price } : {}),
        ...(price === undefined ? { memberPrices: [money("0")] } : {}),
        ...(body.interval !== undefined ? { interval: body.interval } : {}),
      }),
    );
    return created(c, bundle);
  });

  app.get("/", async (c) => {
    // Tenant-scoped: only the authenticated organization's bundles.
    const bundles = await c.get("ctx").bundles.listBundles({ organizationId: requireOrg(c) });
    return data(c, bundles);
  });

  app.get("/:id", async (c) => {
    const bundle = unwrapResult(await c.get("ctx").bundles.getBundle(c.req.param("id")));
    return data(c, bundle);
  });

  // Patch mutable bundle fields (immutably persisted through the store).
  app.patch("/:id", async (c) => {
    const ctx = c.get("ctx");
    const current = unwrapResult(await ctx.bundles.getBundle(c.req.param("id")));
    const body = await parseBody(c, patchSchema);
    if (body.status === "archived") {
      return data(c, unwrapResult(await ctx.bundles.archiveBundle(current.id)));
    }
    const updated = {
      ...current,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      updatedAt: new Date().toISOString(),
    };
    return data(c, await ctx.bundleStore.save(updated));
  });

  app.post("/:id/publish", async (c) => {
    const ctx = c.get("ctx");
    const current = unwrapResult(await ctx.bundles.getBundle(c.req.param("id")));
    const published = {
      ...current,
      status: "active" as const,
      updatedAt: new Date().toISOString(),
    };
    return data(c, await ctx.bundleStore.save(published));
  });

  return app;
}
