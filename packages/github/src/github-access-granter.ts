import { generateId } from "@settlekit/common";
import type { GitHubRepoAccessGrant } from "@settlekit/common";
import type { GitHubAccessClient, GrantRepoAccessInput } from "./types.js";

export async function grantGitHubRepoAccess(
  client: GitHubAccessClient,
  input: GrantRepoAccessInput,
  now = new Date(),
): Promise<GitHubRepoAccessGrant> {
  const invite = await client.inviteRepoCollaborator({
    installationId: input.installationId,
    owner: input.repoOwner,
    repo: input.repoName,
    username: input.githubUsername,
    permission: input.permission ?? "pull",
  });

  return {
    id: generateId("githubRepoAccess"),
    organizationId: input.organizationId,
    installationId: input.installationId,
    customerId: input.customerId,
    entitlementId: input.entitlementId,
    repoOwner: input.repoOwner,
    repoName: input.repoName,
    githubUsername: input.githubUsername,
    invitationId: invite.invitationId,
    status: invite.invitationId ? "invited" : "active",
    createdAt: now.toISOString(),
  };
}
