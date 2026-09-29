/**
 * Entitlement routes (plan §14, §4).
 *
 * The universal access layer. Lists a customer's entitlements, verifies access
 * (feature flag / credits / product) via `EntitlementService.verify`, spends
 * credits, and revokes. The hot-path verify endpoint is what the SDK calls.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { notFound, type Entitlement } from "@settlekit/common";
import type { AppEnv } from "../context.js";
import { data } from "../http/respond.js";
import { parseBody, validate } from "../http/validate.js";
import { requireOwned } from "../http/tenant.js";

const verifySchema = z
  .object({
    customerId: z.string().min(1),
    productId: z.string().optional(),
    feature: z.string().optional(),
    requiredCredits: z.number().int().positive().optional(),
  })
  .strict();

const spendSchema = z.object({
  customerId: z.string().min(1),
  productId: z.string().min(1),
  amount: z.number().int().positive(),
});

const revokeSchema = z.object({
  reason: z.string().min(1).default("revoked via API"),
});

export function entitlementRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // List a customer's entitlements (optionally active-only / per product).
  app.get("/", async (c) => {
    const ctx = c.get("ctx");
    const customerId = c.req.query("customerId");
    if (!customerId) throw notFound("customerId query param is required");
    const activeOnly = c.req.query("activeOnly") === "true";
    const productId = c.req.query("productId");
    const list = await ctx.entitlementRepo.listByCustomer(customerId, {
      activeOnly,
      ...(productId !== undefined ? { productId } : {}),
    });
    return data(c, list);
  });

  // Verify access (feature / credits / product).
  app.post("/verify", async (c) => {
    const body = await parseBody(c, verifySchema);
    const result = await c.get("ctx").entitlements.verify(body);
    return data(c, result);
  });

  // Spend credits against a product entitlement.
  app.post("/spend-credits", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, spendSchema);
    const updated = await ctx.entitlements.spendCredits(
      body.customerId,
      body.productId,
      body.amount,
    );
    return data(c, updated);
  });

  app.get("/:id", async (c) => {
    return data(c, await ownedEntitlement(c, c.req.param("id")));
  });

  // Revoke an entitlement.
  app.post("/:id/revoke", async (c) => {
    const ctx = c.get("ctx");
    const entitlement = await ownedEntitlement(c, c.req.param("id"));
    const body = validate(revokeSchema, await safeJson(c));
    const revoked = await ctx.entitlements.revoke(entitlement.id, body.reason);
    return data(c, revoked);
  });

  return app;
}

/** Load an entitlement by id, requiring it belongs to the caller's org (else 404). */
async function ownedEntitlement(c: Context<AppEnv>, id: string): Promise<Entitlement> {
  return requireOwned(c, await c.get("ctx").entitlementRepo.findById(id), "entitlement", id);
}

/** Read a JSON body that may be empty, returning `{}` when absent. */
async function safeJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}
