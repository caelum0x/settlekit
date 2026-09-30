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
import { SettleKitError, validationError, type ApiKey } from "@settlekit/common";
import { MANAGEMENT_SCOPES, PLATFORM_ADMIN_SCOPE, PLATFORM_KEY_PRODUCT, WILDCARD_SCOPE, isPlatformKey, scopesAllow } from "@settlekit/api-keys";
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


const platformSchema = z.object({
  /** Management scopes (e.g. payments:read, webhooks:write) or platform:admin. */
  scopes: z
    .array(z.enum([PLATFORM_ADMIN_SCOPE, ...MANAGEMENT_SCOPES] as [string, ...string[]]))
    .min(1),
  /** Who or what the key is for (shown in the dashboard). */
  label: z.string().trim().min(1).max(60).default("API key"),
  env: z.enum(["live", "test"]).default("live"),
});

function keyView(key: ApiKey) {
  return { ...key, kind: isPlatformKey(key) ? ("platform" as const) : ("customer" as const) };
}

export function apiKeyRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // List the organization's key records (never exposes plaintext).
  app.get("/", async (c) => {
    const org = requireOrg(c);
    const keys = (await c.get("ctx").apiKeys.list()).filter((k) => k.organizationId === org);
    return data(c, keys.map(keyView));
  });

  // Issue a platform key with restricted management scopes. A caller can only
  // grant scopes it holds itself (no privilege escalation).
  app.post("/platform", async (c) => {
    const body = await parseBody(c, platformSchema);
    const granted = c.get("grantedScopes") ?? [];
    const exceeding = body.scopes.filter((s) => !scopesAllow(granted, s));
    if (exceeding.length > 0) {
      throw new SettleKitError({
        code: "forbidden",
        message: `You cannot grant scopes you do not hold: ${exceeding.join(", ")}`,
        details: { scopes: exceeding },
      });
    }
    const result = await c.get("ctx").apiKeys.issue({
      organizationId: requireOrg(c),
      customerId: body.label,
      productId: PLATFORM_KEY_PRODUCT,
      entitlementId: PLATFORM_KEY_PRODUCT,
      scopes: body.scopes,
      env: body.env,
    });
    return created(c, { apiKey: keyView(result.apiKey), plaintext: result.plaintext });
  });

  // Revoke a key of this organization by id.
  app.post("/:id/revoke", async (c) => {
    return data(c, keyView(await c.get("ctx").apiKeys.revokeById(c.req.param("id"), requireOrg(c))));
  });

  // Issue a new API key. Returns the one-time plaintext.
  app.post("/", async (c) => {
    const body = await parseBody(c, issueSchema);
    // Customer access keys never carry management scopes (use /platform).
    const management = body.scopes.filter((s) => s === WILDCARD_SCOPE || s === PLATFORM_ADMIN_SCOPE || (MANAGEMENT_SCOPES as readonly string[]).includes(s));
    if (management.length > 0) {
      throw validationError(`customer keys cannot carry management scopes (${management.join(", ")}); use POST /v1/api-keys/platform`, {
        fields: ["scopes"],
      });
    }
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
