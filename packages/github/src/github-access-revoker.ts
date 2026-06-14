import type { GitHubRepoAccessGrant } from "@settlekit/common";
import type { GitHubAccessClient, RevokeRepoAccessInput } from "./types.js";

export async function revokeGitHubRepoAccess(
  client: GitHubAccessClient,
  input: RevokeRepoAccessInput,
): Promise<void> {
  await client.removeRepoCollaborator({
    installationId: input.installationId,
    owner: input.repoOwner,
    repo: input.repoName,
    username: input.githubUsername,
  });
}

export function markGitHubGrantRevoked(grant: GitHubRepoAccessGrant, now = new Date()): GitHubRepoAccessGrant {
  return { ...grant, status: "revoked", revokedAt: now.toISOString() };
}
