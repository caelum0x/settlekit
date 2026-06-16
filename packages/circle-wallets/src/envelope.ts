/**
 * Shared response handling for the W3S wallets client: success-status
 * assertion and `{ data }` envelope unwrapping, mapping non-2xx responses to a
 * `SettleKitError({ code: "integration_error" })` that carries the Circle error
 * body in `details`. Mirrors the conventions in `@settlekit/circle`.
 */
import { SettleKitError } from "@settlekit/common";
import type { WalletsRequest, WalletsResponse } from "./http.js";
import type { CircleWalletsEnvelope, CircleWalletsErrorBody } from "./types.js";

export function assertOk(res: WalletsResponse, req: WalletsRequest): void {
  if (res.status >= 200 && res.status < 300) return;
  const errorBody = (res.body ?? {}) as CircleWalletsErrorBody;
  const message =
    typeof errorBody.message === "string" && errorBody.message.length > 0
      ? errorBody.message
      : `Circle W3S request ${req.method} ${req.path} failed with status ${res.status}`;
  throw new SettleKitError({
    code: "integration_error",
    message,
    httpStatus: 502,
    retryable: res.status >= 500 || res.status === 429,
    details: {
      status: res.status,
      request: { method: req.method, path: req.path },
      circleError: res.body,
    },
  });
}

export function unwrapData<T>(body: unknown, req: WalletsRequest): T {
  if (body && typeof body === "object" && "data" in body) {
    return (body as CircleWalletsEnvelope<T>).data;
  }
  throw new SettleKitError({
    code: "integration_error",
    message: `Circle W3S response for ${req.method} ${req.path} was missing the data envelope`,
    httpStatus: 502,
    details: { request: { method: req.method, path: req.path }, body },
  });
}

export function requireString(value: string, op: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new SettleKitError({ code: "validation_error", message: `${op} requires a non-empty value` });
  }
}
