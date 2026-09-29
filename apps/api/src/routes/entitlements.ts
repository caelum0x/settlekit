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
import { requireOrg, requireOwned, scopeToOrg } from "../http/tenant.js";

const verifySchema = z
  .object({
    customerId: z.string().min(1).optional(),
    /** Check by the buyer's checkout email instead of a customer id. */
    email: z.string().email().optional(),
    productId: z.string().optional(),
    feature: z.string().optional(),
    requiredCredits: z.number().int().positive().optional(),
  })
  .strict()
  .refine((b) => b.customerId !== undefined || b.email !== undefined, { message: "customerId or email is required" });

/** Customer ids of the caller's org to check: the given id, or every customer with the email. */
async function customerIdsFor(c: Context<AppEnv>, input: { customerId?: string | undefined; email?: string | undefined }): Promise<string[]> {
  if (input.customerId) return [input.customerId];
  const org = requireOrg(c);
  const email = (input.email ?? "").toLowerCase();
  const matches = await c.get("ctx").customers.list((cu) => cu.organizationId === org && cu.email.toLowerCase() === email);
  return matches.map((cu) => cu.id);
}

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
    const email = c.req.query("email");
    if (!customerId && !email) throw notFound("customerId or email query param is required");
    const activeOnly = c.req.query("activeOnly") === "true";
    const productId = c.req.query("productId");
    const lists = await Promise.all(
      (await customerIdsFor(c, { customerId, email })).map((id) =>
        ctx.entitlementRepo.listByCustomer(id, { activeOnly, ...(productId !== undefined ? { productId } : {}) }),
      ),
    );
    return data(c, scopeToOrg(c, lists.flat()));
  });

  // Verify access (feature / credits / product), scoped to the caller's org.
  app.post("/verify", async (c) => {
    const body = await parseBody(c, verifySchema);
    const org = requireOrg(c);
    const { customerId: _id, email: _email, ...check } = body;
    let result: { allowed: boolean; reason?: string } = { allowed: false, reason: "no_active_entitlement" };
    for (const id of await customerIdsFor(c, body)) {
      const attempt = await c.get("ctx").entitlements.verify({ ...check, customerId: id });
      const owned = !attempt.entitlement || attempt.entitlement.organizationId === org;
      if (attempt.allowed && owned) return data(c, attempt);
      if (owned) result = attempt;
    }
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

