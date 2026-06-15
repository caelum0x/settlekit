import { validationError } from "@settlekit/common";
import type { GitHubApi } from "./github-app-client.js";
import { toGitHubIntegrationError } from "./github-errors.js";
import type { GitHubUsernameVerification } from "./types.js";

const USERNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

/** Cheap, offline syntactic validation of a GitHub login. */
export function isValidGitHubUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

/**
 * Verify a GitHub username against the live API (GET /users/{username}).
 * Returns `{ exists, user }` where `user` carries the stable numeric id used to
 * detect later username renames. Invalid syntax fails fast as a validation
 * error before any network call.
 */
export async function verifyGithubUsername(
  api: GitHubApi,
  username: string,
): Promise<GitHubUsernameVerification> {
  const trimmed = username.trim();
  if (!isValidGitHubUsername(trimmed)) {
    throw validationError("verifyGithubUsername: malformed GitHub username", { username });
  }

  try {
    const user = await api.getUser(trimmed);
    if (!user) return { exists: false };
    return { exists: true, user };
  } catch (error) {
    throw toGitHubIntegrationError(error, `verifyGithubUsername(${trimmed})`);
  }
}
