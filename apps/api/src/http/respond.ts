/**
 * Consistent API response envelope helpers (plan API patterns).
 *
 * Every successful response is `{ data }`; every error response is `{ error }`.
 * These helpers keep the shape uniform across every route module.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { SettleKitError } from "@settlekit/common";

/** A successful response body: `{ data: <payload> }`. */
export interface DataEnvelope<T> {
  data: T;
}

/** An error response body: `{ error: { code, message, details? } }`. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Send a `{ data }` envelope with an optional explicit status (default 200). */
export function data<T>(
  c: Context,
  payload: T,
  status: ContentfulStatusCode = 200,
): Response {
  return c.json<DataEnvelope<T>>({ data: payload }, status);
}

/** Send a `201 Created` `{ data }` envelope. */
export function created<T>(c: Context, payload: T): Response {
  return data(c, payload, 201);
}

/**
 * Map a {@link SettleKitError} to its JSON error envelope using the error's own
 * `httpStatus`. Unknown errors collapse to a 500 `internal_error`.
 */
export function error(c: Context, err: unknown): Response {
  if (SettleKitError.is(err)) {
    return c.json<ErrorEnvelope>(
      { error: err.toJSON() as ErrorEnvelope["error"] },
      err.httpStatus as ContentfulStatusCode,
    );
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  return c.json<ErrorEnvelope>(
    { error: { code: "internal_error", message } },
    500,
  );
}
