/**
 * Small internal helpers shared by the HTTP layer.
 *
 * Kept separate so `validate.ts` can stay focused on schema parsing while still
 * re-exporting these for route modules.
 */
import { validationError as commonValidationError, type Result, type SettleKitError } from "@settlekit/common";

/** Re-export `validationError` so the HTTP layer imports it from one place. */
export const validationError = commonValidationError;

/**
 * Unwrap a {@link Result} returned by a domain service. On error the contained
 * {@link SettleKitError} is thrown so the central error handler maps it to the
 * `{ error }` envelope with the right HTTP status.
 */
export function unwrapResult<T>(result: Result<T, SettleKitError>): T {
  if (result.ok) return result.value;
  throw result.error;
}
