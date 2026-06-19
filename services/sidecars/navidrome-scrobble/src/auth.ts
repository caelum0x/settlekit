/**
 * Bearer-token guard for the sidecar's state-changing (money-moving) endpoints.
 *
 * The sidecar receives webhooks that bind payout wallets and accrue royalties, so
 * an exposed, unauthenticated endpoint lets anyone redirect a creator's earnings.
 * When `SIDECAR_AUTH_TOKEN` is configured the guard requires
 * `Authorization: Bearer <token>` (compared in constant time) on every guarded
 * route; when it is unset the guard is a no-op, so local demos and tests run
 * without ceremony. Read-only routes (`/`, `/health`) and the x402-paid content
 * route stay open — payment is their gate.
 */

import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const BEARER_PREFIX = "Bearer ";

/** Constant-time string compare that never short-circuits on length. */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Build the guard. Pass `config.authToken`; when it is undefined/empty the
 * returned middleware allows every request (demo/test mode).
 */
export function requireBearer(token: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (token === undefined || token.length === 0) {
      return next();
    }
    const header = c.req.header("authorization") ?? "";
    const provided = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : "";
    if (provided.length === 0 || !constantTimeEqual(provided, token)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  };
}
