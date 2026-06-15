/**
 * Bearer API-key authentication middleware (plan §4).
 *
 * Reads `Authorization: Bearer <plaintext>` and verifies it against the real
 * `@settlekit/api-keys` `ApiKeyService`. On success it stamps `lastUsedAt` on
 * the key and exposes the key id on the request context; on failure it throws a
 * `unauthorized` {@link SettleKitError} (HTTP 401) which the error middleware
 * maps to `{ error }`.
 *
 * A bootstrap key may be supplied via `API_BOOTSTRAP_KEY` so the very first
 * caller can authenticate before any keys exist in the store — handy for local
 * dev and for the test client.
 */
import type { MiddlewareHandler } from "hono";
import { SettleKitError } from "@settlekit/common";
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
    if (bootstrapKey && plaintext === bootstrapKey) {
      c.set("apiKeyId", "bootstrap");
      await next();
      return;
    }

    const ctx = c.get("ctx");
    const result = await ctx.apiKeys.verify(plaintext);
    if (!result.valid || !result.apiKey) {
      throw unauthorized("Invalid or revoked API key");
    }

    // Best-effort usage stamp; never block the request on a usage write failure.
    try {
      await ctx.apiKeys.recordUsage(plaintext);
    } catch {
      /* non-fatal */
    }

    c.set("apiKeyId", result.apiKey.id);
    await next();
  };
}
