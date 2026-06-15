import type { GitHubRepoAccessGrant } from "@settlekit/common";
import { toGitHubIntegrationError } from "./github-errors.js";
import type { GitHubAccessClient, RevokeRepoAccessInput } from "./types.js";

/**
 * Revoke a user's repository access by removing them as a collaborator
 * (DELETE /repos/{owner}/{repo}/collaborators/{username}).
 *
 * GitHub returns 204 whether or not the user was a collaborator, so this is
 * naturally idempotent. Any transport / auth failure is mapped to a
 * SettleKitError `integration_error`.
 */
export async function revokeGitHubRepoAccess(
  client: GitHubAccessClient,
  input: RevokeRepoAccessInput,
): Promise<void> {
  try {
    await client.removeRepoCollaborator({
      installationId: input.installationId,
      owner: input.repoOwner,
      repo: input.repoName,
      username: input.githubUsername,
    });
  } catch (error) {
    throw toGitHubIntegrationError(
      error,
      `revokeGitHubRepoAccess(${input.repoOwner}/${input.repoName}:${input.githubUsername})`,
    );
  }
}

/** Produce a new grant record marked as revoked at `now`. */
export function markGitHubGrantRevoked(grant: GitHubRepoAccessGrant, now = new Date()): GitHubRepoAccessGrant {
  return { ...grant, status: "revoked", revokedAt: now.toISOString() };
}
