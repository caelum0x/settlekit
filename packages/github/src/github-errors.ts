import { SettleKitError } from "@settlekit/common";

/**
 * Shape of an error thrown by Octokit's request layer. We only read the fields
 * we care about so we don't couple to a specific Octokit version.
 */
interface OctokitLikeError {
  status?: number;
  message?: string;
  response?: {
    data?: { message?: string; errors?: unknown };
    headers?: Record<string, string | undefined>;
  };
}

function isOctokitLikeError(value: unknown): value is OctokitLikeError {
  return typeof value === "object" && value !== null && ("status" in value || "response" in value);
}

/** HTTP status codes GitHub returns that are worth retrying. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Translate any error raised while talking to GitHub into a SettleKitError with
 * code `integration_error`. The original error is preserved as `cause` and the
 * upstream HTTP status is surfaced in `details.githubStatus` for observability.
 */
export function toGitHubIntegrationError(error: unknown, context: string): SettleKitError {
  if (SettleKitError.is(error)) return error;

  if (isOctokitLikeError(error)) {
    const status = typeof error.status === "number" ? error.status : undefined;
    const upstreamMessage = error.response?.data?.message ?? error.message ?? "GitHub request failed";
    return new SettleKitError({
      code: "integration_error",
      message: `${context}: ${upstreamMessage}`,
      retryable: status !== undefined && RETRYABLE_STATUS.has(status),
      details: { githubStatus: status, context },
      cause: error,
    });
  }

  return new SettleKitError({
    code: "integration_error",
    message: `${context}: ${error instanceof Error ? error.message : String(error)}`,
    retryable: false,
    details: { context },
    cause: error,
  });
}

/** Returns the HTTP status of an Octokit-style error, or undefined. */
export function githubErrorStatus(error: unknown): number | undefined {
  if (isOctokitLikeError(error) && typeof error.status === "number") return error.status;
  return undefined;
}

/** True when the error is a GitHub 404 (resource / membership not found). */
export function isNotFoundError(error: unknown): boolean {
  return githubErrorStatus(error) === 404;
}

/**
 * True when GitHub reports a 422 Unprocessable Entity. For the
 * add-collaborator endpoint this is returned when the user is already a
 * collaborator, which we treat as success (idempotency).
 */
export function isAlreadyExistsError(error: unknown): boolean {
  return githubErrorStatus(error) === 422;
}
