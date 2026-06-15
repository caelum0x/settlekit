/**
 * SDK error type.
 *
 * Every non-2xx response from the SettleKit API is surfaced as a
 * {@link SettleKitApiError}. It carries the HTTP `status`, the API error
 * `code`/`message`, and any structured `details` from the `{ error }` envelope,
 * so callers can branch on `code` (e.g. `not_found`, `validation_error`) without
 * parsing strings.
 */

/** Shape of the API's `{ error }` envelope body. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Options used to construct a {@link SettleKitApiError}. */
export interface SettleKitApiErrorOptions {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  /** The request that produced the error, for debugging. */
  request?: { method: string; url: string };
}

/**
 * Error thrown by the SDK for any failed API call (non-2xx response, network
 * failure, timeout, or unparseable body).
 */
export class SettleKitApiError extends Error {
  /** HTTP status code (0 when the request never completed, e.g. network/timeout). */
  readonly status: number;
  /** Machine-readable error code from the API (or a synthetic SDK code). */
  readonly code: string;
  /** Optional structured details from the API error envelope. */
  readonly details?: Record<string, unknown>;
  /** The originating request (method + URL), when available. */
  readonly request?: { method: string; url: string };

  constructor(opts: SettleKitApiErrorOptions) {
    super(opts.message);
    this.name = "SettleKitApiError";
    this.status = opts.status;
    this.code = opts.code;
    if (opts.details !== undefined) this.details = opts.details;
    if (opts.request !== undefined) this.request = opts.request;
    // Restore prototype chain when targeting older runtimes.
    Object.setPrototypeOf(this, SettleKitApiError.prototype);
  }

  /** Type guard usable across realms by name. */
  static is(value: unknown): value is SettleKitApiError {
    return (
      value instanceof SettleKitApiError ||
      (typeof value === "object" &&
        value !== null &&
        (value as { name?: unknown }).name === "SettleKitApiError")
    );
  }
}
