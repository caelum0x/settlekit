/**
 * A lightweight Result type for operations that can fail in expected ways
 * (network errors, validation, revocation conflicts) without throwing.
 */
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = SettleKitError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/** Unwrap a Result or throw if it is an error. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error instanceof Error ? r.error : new Error(String(r.error));
}

export type ErrorCode =
  | "validation_error"
  | "not_found"
  | "conflict"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "payment_required"
  | "payment_failed"
  | "integration_error"
  | "delivery_failed"
  | "insufficient_credits"
  | "entitlement_expired"
  | "internal_error";

export interface SettleKitErrorOptions {
  code: ErrorCode;
  message: string;
  /** HTTP status to surface at the API boundary. */
  httpStatus?: number;
  /** Whether retrying the operation may succeed. */
  retryable?: boolean;
  /** Structured detail safe to return to API clients. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  not_found: 404,
  conflict: 409,
  unauthorized: 401,
  forbidden: 403,
  rate_limited: 429,
  payment_required: 402,
  payment_failed: 402,
  integration_error: 502,
  delivery_failed: 500,
  insufficient_credits: 402,
  entitlement_expired: 403,
  internal_error: 500,
};

/** The single error type used across SettleKit packages. */
export class SettleKitError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(opts: SettleKitErrorOptions) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "SettleKitError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus ?? DEFAULT_STATUS[opts.code];
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }

  /** JSON-safe representation for API responses (never leaks `cause`). */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }

  static is(value: unknown): value is SettleKitError {
    return value instanceof SettleKitError;
  }
}

export function validationError(message: string, details?: Record<string, unknown>): SettleKitError {
  return new SettleKitError({ code: "validation_error", message, details });
}

export function notFound(message: string, details?: Record<string, unknown>): SettleKitError {
  return new SettleKitError({ code: "not_found", message, details });
}

export function conflict(message: string, details?: Record<string, unknown>): SettleKitError {
  return new SettleKitError({ code: "conflict", message, details });
}
