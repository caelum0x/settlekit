/**
 * Bearer authentication middleware (plan §4).
 *
 * Accepts two credential kinds in the `Authorization: Bearer <token>` slot:
 *   1. A programmatic **API key** (`sk_live_…`), verified against the real
 *      `@settlekit/api-keys` `ApiKeyService`. Its `organizationId` is bound.
 *   2. A first-party **session token** (the dashboard's `sk_session`), verified
 *      against the `@settlekit/auth` service. The signed-in account's
 *      `organizationId` is bound. This lets the merchant dashboard call the API
 *      with the session it already holds — no long-lived platform key in the
 *      browser. Sessions for accounts without an organization are rejected.
 *
 * On success it exposes the credential id + the bound `organizationId` on the
 * request context so routes scope every read/write to the caller's tenant; on
 * failure it throws a `unauthorized` {@link SettleKitError} (HTTP 401) which the
 * error middleware maps to `{ error }`.
 *
 * A bootstrap key may be supplied via `API_BOOTSTRAP_KEY` so the very first
 * caller can authenticate before any keys exist in the store — handy for local
 * dev and for the test client.
 */
import type { MiddlewareHandler } from "hono";
import { SettleKitError } from "@settlekit/common";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import type { AppEnv } from "../context.js";

const BEARER_RE = /^Bearer\s+(.+)$/i;

function unauthorized(message: string): SettleKitError {
  return new SettleKitError({ code: "unauthorized", message });
}

/** Require a valid Bearer API key on every request this middleware guards. */
export function authMiddleware(): MiddlewareHandler<AppEnv> {
  const bootstrapKey = process.env.API_BOOTSTRAP_KEY;

  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header) {
      throw unauthorized("Missing Authorization header");
    }
    const match = BEARER_RE.exec(header);
    if (!match || !match[1]) {
      throw unauthorized("Authorization header must be 'Bearer <api-key>'");
    }
    const plaintext = match[1].trim();

    // Bootstrap path: a configured static key authenticates without the store.
    // It operates on the platform default organization.
    if (bootstrapKey && plaintext === bootstrapKey) {
      c.set("apiKeyId", "bootstrap");
      c.set("organizationId", DEFAULT_ORG_ID);
      await next();
      return;
    }

    const ctx = c.get("ctx");
    const result = await ctx.apiKeys.verify(plaintext);
    if (result.valid && result.apiKey) {
      // Best-effort usage stamp; never block the request on a usage write failure.
      try {
        await ctx.apiKeys.recordUsage(plaintext);
      } catch {
        /* non-fatal */
      }

      c.set("apiKeyId", result.apiKey.id);
      // Bind the key's organization so routes scope reads/writes to the tenant.
      c.set("organizationId", result.apiKey.organizationId);
      await next();
      return;
    }

    // Not an API key — try a first-party session token (the dashboard's
    // `sk_session`). A valid merchant session scopes the request to its org.
    const session = await ctx.auth.authenticateSession(plaintext);
    if (session.ok) {
      const { account } = session.value;
      if (!account.organizationId) {
        throw unauthorized("Session account has no organization");
      }
      c.set("apiKeyId", `session:${account.id}`);
      c.set("organizationId", account.organizationId);
      await next();
      return;
    }

    throw unauthorized("Invalid or revoked credential");
  };
}
