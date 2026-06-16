/**
 * Structured request logging: one JSON line per request to stdout, so logs are
 * machine-parseable in production (ship to any log pipeline) while staying
 * greppable in dev. Captures method, path, status, duration, the request id, and
 * the caller's IP. No `console.log` — the single sink is `process.stdout`.
 *
 * Set `REQUEST_LOG=false` to silence (e.g. in tests). The health probe is not
 * logged to avoid drowning out signal with liveness checks.
 */
import type { MiddlewareHandler } from "hono";

/** Emit one structured JSON log line. */
function emit(fields: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), app: "api", ...fields })}\n`);
}

export function loggingMiddleware(): MiddlewareHandler {
  // On by default, except under test (keeps test output clean).
  const fallback = process.env.NODE_ENV === "test" ? "false" : "true";
  const enabled = (process.env.REQUEST_LOG ?? fallback).toLowerCase() !== "false";

  return async (c, next) => {
    if (!enabled || c.req.path === "/health") return next();

    const start = performance.now();
    let errored = false;
    try {
      await next();
    } catch (err) {
      errored = true;
      emit({
        level: "error",
        msg: "request",
        method: c.req.method,
        path: c.req.path,
        requestId: c.res.headers.get("x-request-id"),
        durationMs: Math.round(performance.now() - start),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      if (!errored) {
        const status = c.res.status;
        emit({
          level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
          msg: "request",
          method: c.req.method,
          path: c.req.path,
          status,
          requestId: c.res.headers.get("x-request-id"),
          durationMs: Math.round(performance.now() - start),
          ip:
            c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
            c.req.header("x-real-ip") ??
            undefined,
        });
      }
    }
  };
}
