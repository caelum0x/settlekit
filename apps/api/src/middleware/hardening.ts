/**
 * Production hardening middleware for the API: CORS, a per-key rate limiter, and
 * request-id propagation. These are real, dependency-light implementations
 * suitable for a horizontally-scaled stateless API (the rate limiter is
 * per-instance in-memory; front it with a shared limiter at the edge for global
 * limits).
 */
import type { MiddlewareHandler } from "hono";
import { generateSecret } from "@settlekit/common";
import {
  rateLimitAllows,
  consumeRateLimit,
  type RateLimitWindow,
} from "@settlekit/rate-limits";

/** Read a positive integer env var with a default. */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Permissive-by-default CORS so the first-party Next apps (and SDKs running in
 * the browser) can call the API. Set `CORS_ORIGIN` to lock it to a specific
 * origin (comma-separated list supported); defaults to `*`.
 */
export function corsMiddleware(): MiddlewareHandler {
  const configured = (process.env.CORS_ORIGIN ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return async (c, next) => {
    const requestOrigin = c.req.header("origin");
    const allowAll = configured.includes("*");
    const origin = allowAll ? "*" : requestOrigin && configured.includes(requestOrigin) ? requestOrigin : configured[0];

    c.header("Access-Control-Allow-Origin", origin ?? "*");
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Payment,X-Request-Id");
    c.header("Access-Control-Max-Age", "86400");

    // Short-circuit preflight requests.
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  };
}

/**
 * Attach (or propagate) an `X-Request-Id` to every request + response, so a call
 * can be traced across logs. Honors an inbound id when present.
 */
export function requestIdMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.header("x-request-id") ?? `req_${generateSecret(12)}`;
    c.header("X-Request-Id", id);
    await next();
  };
}

/**
 * A per-instance fixed-window rate limiter keyed by API key (falling back to the
 * client IP). General limit is `RATE_LIMIT_PER_MINUTE` (default 600); the auth
 * subtree (`/v1/auth/*`, e.g. unauthenticated wallet-nonce issuance) gets a much
 * stricter `AUTH_RATE_LIMIT_PER_MINUTE` (default 20) in its own bucket to stop
 * nonce-spam / credential-stuffing. Set `RATE_LIMIT_ENABLED=false` to disable.
 * Only `/health` and paid (x402) routes are exempt — payment is their gate.
 *
 * `X-Forwarded-For` is attacker-spoofable unless the API sits behind a trusted
 * proxy that sets it authoritatively; it is only honored when `TRUST_PROXY`
 * is true (default true, since the API deploys behind Render/Vercel). When
 * false, only `x-real-ip` is used so a client cannot forge its limiter bucket.
 */
export function rateLimitMiddleware(): MiddlewareHandler {
  const enabled = (process.env.RATE_LIMIT_ENABLED ?? "true").toLowerCase() !== "false";
  const limit = intEnv("RATE_LIMIT_PER_MINUTE", 600);
  const authLimit = intEnv("AUTH_RATE_LIMIT_PER_MINUTE", 20);
  const trustProxy = (process.env.TRUST_PROXY ?? "true").toLowerCase() !== "false";
  const windowMs = 60_000;
  const windows = new Map<string, RateLimitWindow>();

  /** Derive a stable limiter key for the caller. */
  function callerKey(authHeader: string | undefined, ip: string): string {
    if (authHeader && authHeader.startsWith("Bearer ")) return `key:${authHeader.slice(7)}`;
    return `ip:${ip}`;
  }

  return async (c, next) => {
    if (!enabled) return next();
    const path = c.req.path;
    if (path === "/health" || path.startsWith("/v1/paid")) {
      return next();
    }

    const ip =
      (trustProxy ? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() : undefined) ??
      c.req.header("x-real-ip") ??
      "unknown";
    const isAuth = path.startsWith("/v1/auth");
    // Auth routes get a stricter limit in a SEPARATE bucket (prefix "auth:") so
    // they cannot be starved by — or starve — the general per-caller budget.
    const effectiveLimit = isAuth ? authLimit : limit;
    const key = (isAuth ? "auth:" : "") + callerKey(c.req.header("authorization"), ip);

    const now = new Date();
    const existing = windows.get(key);
    const window: RateLimitWindow =
      existing && new Date(existing.resetsAt).getTime() > now.getTime()
        ? existing
        : { key, limit: effectiveLimit, used: 0, resetsAt: new Date(now.getTime() + windowMs).toISOString() };

    if (!rateLimitAllows(window, 1, now)) {
      const retryAfter = Math.max(1, Math.ceil((new Date(window.resetsAt).getTime() - now.getTime()) / 1000));
      c.header("Retry-After", String(retryAfter));
      c.header("X-RateLimit-Limit", String(effectiveLimit));
      c.header("X-RateLimit-Remaining", "0");
      return c.json(
        { error: { code: "rate_limited", message: `Rate limit exceeded. Retry in ${retryAfter}s.` } },
        429,
      );
    }

    const updated = consumeRateLimit(window, 1);
    windows.set(key, updated);
    c.header("X-RateLimit-Limit", String(effectiveLimit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, effectiveLimit - updated.used)));
    await next();
  };
}
