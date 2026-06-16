/**
 * API key routes (plan §4).
 *
 * Issues scoped API keys for a customer's entitlement via the real
 * `@settlekit/api-keys` `ApiKeyService`. The plaintext secret is returned exactly
 * once on issuance; only its SHA-256 hash is persisted. Also exposes verify
 * (does a presented key grant a set of scopes?) and revoke.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";

const issueSchema = z.object({
  // Derived from the authenticated org (tenant scope); ignored if supplied.
  organizationId: z.string().min(1).optional(),
  customerId: z.string().min(1),
  productId: z.string().min(1),
  entitlementId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  env: z.enum(["live", "test"]).default("live"),
});

const verifySchema = z.object({
  key: z.string().min(1),
  requiredScopes: z.array(z.string().min(1)).default([]),
});

const revokeSchema = z.object({
  key: z.string().min(1),
});

export function apiKeyRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // List all API key records (merchant-wide; never exposes plaintext).
  app.get("/", async (c) => {
    return data(c, await c.get("ctx").apiKeys.list());
  });

  // Issue a new API key. Returns the one-time plaintext.
  app.post("/", async (c) => {
    const body = await parseBody(c, issueSchema);
    const result = await c.get("ctx").apiKeys.issue({
      organizationId: requireOrg(c),
      customerId: body.customerId,
      productId: body.productId,
      entitlementId: body.entitlementId,
      scopes: body.scopes,
      env: body.env,
    });
    return created(c, { apiKey: result.apiKey, plaintext: result.plaintext });
  });

  // Verify a presented key (and required scopes).
  app.post("/verify", async (c) => {
    const body = await parseBody(c, verifySchema);
    const result =
      body.requiredScopes.length > 0
        ? await c.get("ctx").apiKeys.authorize(body.key, body.requiredScopes)
        : await c.get("ctx").apiKeys.verify(body.key);
    return data(c, {
      valid: result.valid,
      ...(result.apiKey ? { apiKey: result.apiKey } : {}),
    });
  });

  // Revoke a key by its plaintext.
  app.post("/revoke", async (c) => {
    const body = await parseBody(c, revokeSchema);
    const revoked = await c.get("ctx").apiKeys.revoke(body.key);
    return data(c, revoked);
  });

  return app;
}
