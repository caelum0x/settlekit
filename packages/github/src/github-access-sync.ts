import type { GitHubRepoAccessGrant } from "@settlekit/common";
import type { GitHubAccessClient } from "./types.js";

export async function syncGitHubRepoGrant(
  client: GitHubAccessClient,
  grant: GitHubRepoAccessGrant,
): Promise<GitHubRepoAccessGrant> {
  if (grant.status === "revoked") return grant;
  const permission = await client.getRepoCollaboratorPermission({
    installationId: grant.installationId,
    owner: grant.repoOwner,
    repo: grant.repoName,
    username: grant.githubUsername,
  });
  return { ...grant, status: permission === "none" ? "invited" : "active" };
}
