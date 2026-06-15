import { generateId } from "@settlekit/common";
import type { GitHubRepoAccessGrant } from "@settlekit/common";
import { isAlreadyExistsError, toGitHubIntegrationError } from "./github-errors.js";
import type { GitHubAccessClient, GrantRepoAccessInput } from "./types.js";

/**
 * Grant a single user access to a private repository by inviting them as a
 * collaborator (POST /repos/{owner}/{repo}/collaborators/{username}).
 *
 * Behaviour:
 *  - A pending invitation (the common case) yields status `invited` with the
 *    returned `invitationId`.
 *  - If GitHub returns no invitation (the user already had access, e.g. an org
 *    member or repeat call) the grant is recorded as `active` immediately.
 *  - A 422 "already a collaborator" response is treated as idempotent success.
 *  - Any other GitHub failure is mapped to a SettleKitError `integration_error`.
 */
export async function grantGitHubRepoAccess(
  client: GitHubAccessClient,
  input: GrantRepoAccessInput,
  now = new Date(),
): Promise<GitHubRepoAccessGrant> {
  const base = {
    id: generateId("githubRepoAccess"),
    organizationId: input.organizationId,
    installationId: input.installationId,
    customerId: input.customerId,
    entitlementId: input.entitlementId,
    repoOwner: input.repoOwner,
    repoName: input.repoName,
    githubUsername: input.githubUsername,
    createdAt: now.toISOString(),
  } as const;

  try {
    const invite = await client.inviteRepoCollaborator({
      installationId: input.installationId,
      owner: input.repoOwner,
      repo: input.repoName,
      username: input.githubUsername,
      permission: input.permission ?? "pull",
    });

    return {
      ...base,
      ...(invite.invitationId !== undefined ? { invitationId: invite.invitationId } : {}),
      status: invite.invitationId !== undefined ? "invited" : "active",
    };
  } catch (error) {
    // Already a collaborator -> the entitlement is effectively satisfied.
    if (isAlreadyExistsError(error)) {
      return { ...base, status: "active" };
    }
    throw toGitHubIntegrationError(
      error,
      `grantGitHubRepoAccess(${input.repoOwner}/${input.repoName}:${input.githubUsername})`,
    );
  }
}

/** Mark a grant as failed (e.g. when an invite could not be delivered). */
export function markGitHubGrantFailed(grant: GitHubRepoAccessGrant): GitHubRepoAccessGrant {
  return { ...grant, status: "failed" };
}
