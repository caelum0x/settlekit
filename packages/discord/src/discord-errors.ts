import { SettleKitError, type ErrorCode } from "@settlekit/common";

/**
 * The JSON error body Discord returns on a failed REST call. Only the fields we
 * read are modelled; see https://discord.com/developers/docs/reference#error-messages.
 */
export interface DiscordErrorBody {
  /** Discord JSON error code (distinct from the HTTP status). */
  code?: number;
  message?: string;
  /** Seconds to wait before retrying (only present on 429 responses). */
  retry_after?: number;
  /** True when the 429 is a global (per-bot) rate limit. */
  global?: boolean;
}

/** HTTP statuses worth retrying when talking to Discord. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    default:
      return "integration_error";
  }
}

/**
 * Translate a failed Discord REST response into a {@link SettleKitError}.
 *
 * - `429` maps to `rate_limited` and surfaces `retryAfterMs` in `details`.
 * - `403` maps to `forbidden` (missing bot permissions).
 * - `401` maps to `unauthorized` (bad/expired bot token).
 * - everything else maps to `integration_error`.
 */
export function toDiscordError(
  status: number,
  body: DiscordErrorBody | undefined,
  context: string,
  retryAfterHeader?: string | null,
): SettleKitError {
  const code = errorCodeForStatus(status);
  const upstreamMessage = body?.message ?? `HTTP ${status}`;

  const details: Record<string, unknown> = {
    context,
    discordStatus: status,
  };
  if (body?.code !== undefined) details.discordCode = body.code;

  if (status === 429) {
    const retryAfterMs = resolveRetryAfterMs(body, retryAfterHeader);
    details.retryAfterMs = retryAfterMs;
    details.global = body?.global ?? false;
  }

  return new SettleKitError({
    code,
    message: `${context}: ${upstreamMessage}`,
    retryable: RETRYABLE_STATUS.has(status),
    details,
  });
}

/** Wrap a transport-level (network) failure as a retryable integration error. */
export function toDiscordTransportError(error: unknown, context: string): SettleKitError {
  if (SettleKitError.is(error)) return error;
  return new SettleKitError({
    code: "integration_error",
    message: `${context}: ${error instanceof Error ? error.message : String(error)}`,
    retryable: true,
    details: { context },
    cause: error,
  });
}

/**
 * Resolve the retry delay in milliseconds from either the JSON body
 * (`retry_after`, in seconds) or the `Retry-After` header (also seconds).
 */
export function resolveRetryAfterMs(
  body: DiscordErrorBody | undefined,
  retryAfterHeader?: string | null,
): number {
  if (typeof body?.retry_after === "number" && Number.isFinite(body.retry_after)) {
    return Math.ceil(body.retry_after * 1000);
  }
  if (retryAfterHeader) {
    const seconds = Number.parseFloat(retryAfterHeader);
    if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
  }
  return 0;
}

/** True when the error represents a Discord 429 rate-limit response. */
export function isRateLimited(error: unknown): boolean {
  return SettleKitError.is(error) && error.code === "rate_limited";
}

/** True when the error represents a Discord 403 missing-permissions response. */
export function isMissingPermissions(error: unknown): boolean {
  return SettleKitError.is(error) && error.code === "forbidden";
}
