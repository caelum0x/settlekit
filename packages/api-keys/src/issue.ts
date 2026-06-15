import { randomBytes } from "node:crypto";
import { generateId, validationError, type ApiKey } from "@settlekit/common";
import { hashApiKey } from "./hash.js";
import type { ApiKeyEnv, IssueApiKeyInput, IssueApiKeyResult } from "./types.js";

/** Number of random bytes of entropy in the secret portion of a key. */
const SECRET_BYTES = 24;

/** Length of the non-secret display prefix, e.g. "sk_live_ab12cd34". */
const PREFIX_LENGTH = 16;

const VALID_ENVS: readonly ApiKeyEnv[] = ["live", "test"];

/**
 * Build the plaintext secret for a key: `sk_<env>_<base64url(randomBytes(24))>`.
 * This value is shown exactly once and never persisted.
 */
function generatePlaintext(env: ApiKeyEnv): string {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return `sk_${env}_${secret}`;
}

/**
 * Issue a new API key for a customer's entitlement.
 *
 * Returns both the persistable {@link ApiKey} record (which stores only the
 * SHA-256 hash plus a non-secret display prefix) and the one-time `plaintext`
 * secret. Callers MUST surface `plaintext` to the user immediately and never
 * store it.
 */
export function issueApiKey(input: IssueApiKeyInput, now: Date = new Date()): IssueApiKeyResult {
  if (!VALID_ENVS.includes(input.env)) {
    throw validationError(`Invalid API key env: ${String(input.env)}`, { env: input.env });
  }
  if (input.scopes.length === 0) {
    throw validationError("At least one scope is required to issue an API key");
  }

  const plaintext = generatePlaintext(input.env);

  const apiKey: ApiKey = {
    id: generateId("apiKey"),
    organizationId: input.organizationId,
    customerId: input.customerId,
    productId: input.productId,
    entitlementId: input.entitlementId,
    keyHash: hashApiKey(plaintext),
    keyPrefix: plaintext.slice(0, PREFIX_LENGTH),
    // Defensive copy + de-dup so the stored record can't be mutated by callers.
    scopes: [...new Set(input.scopes)],
    status: "active",
    createdAt: now.toISOString(),
  };

  return { apiKey, plaintext };
}
