/**
 * Central error mapping middleware.
 *
 * Wraps every downstream handler in a try/catch and converts thrown errors into
 * the `{ error }` envelope. {@link SettleKitError} instances map to their own
 * `httpStatus` + JSON shape; anything else collapses to a 500 `internal_error`
 * without leaking internals. This guarantees a uniform error contract even when
 * a route forgets to catch.
 */
import type { MiddlewareHandler } from "hono";
import { error } from "../http/respond.js";

/** Catch-all error handler middleware. Register it first on the app. */
export function errorMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    try {
      await next();
    } catch (err) {
      return error(c, err);
    }
  };
}
