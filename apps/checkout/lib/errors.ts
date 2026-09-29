/**
 * Typed checkout failures. Route handlers map `code` to an HTTP status so the
 * buyer sees a clear, specific message (never a generic 500) and no caller has
 * to string-match error messages.
 */

export type CheckoutErrorCode =
  | "session_not_found"
  | "malformed_tx"
  | "duplicate_tx"
  | "verification_failed"
  | "network_not_configured"
  | "missing_reference"
  | "fields_incomplete"
  | "session_not_payable"
  | "invalid_request"
  | "network_not_accepted"
  | "payment_pending"
  | "payment_under_review"
  | "quote_unavailable"
  | "forbidden_origin";

const STATUS: Readonly<Record<CheckoutErrorCode, number>> = {
  session_not_found: 404,
  malformed_tx: 400,
  duplicate_tx: 409,
  verification_failed: 422,
  network_not_configured: 503,
  missing_reference: 409,
  fields_incomplete: 422,
  session_not_payable: 409,
  invalid_request: 400,
  network_not_accepted: 422,
  // The transaction exists but is not final yet (unmined, too few
  // confirmations, explorer throttled): poll again.
  payment_pending: 425,
  // Paid after the quote expired: a human reviews it before access is granted.
  payment_under_review: 409,
  quote_unavailable: 502,
  forbidden_origin: 403,
};

export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode;

  constructor(code: CheckoutErrorCode, message: string) {
    super(message);
    this.name = "CheckoutError";
    this.code = code;
  }

  /** HTTP status the route layer should answer with. */
  get status(): number {
    return STATUS[this.code];
  }
}

export function isCheckoutError(error: unknown): error is CheckoutError {
  return error instanceof CheckoutError;
}

/** Postgres unique_violation, possibly wrapped by the driver/ORM in `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Map any thrown value to a JSON-able `{ status, error, code? }` for a route reply. */
export function toRouteError(
  error: unknown,
  fallback: string,
): { status: number; error: string; code?: CheckoutErrorCode } {
  if (isCheckoutError(error)) return { status: error.status, error: error.message, code: error.code };
  return { status: 500, error: fallback };
}
