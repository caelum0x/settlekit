import type { GitHubApi } from "./github-app-client.js";
import { toGitHubIntegrationError } from "./github-errors.js";
import type { GitHubRepoInvitation, GitHubRepository } from "./types.js";

export function formatRepositoryName(repo: Pick<GitHubRepository, "owner" | "name">): string {
  return `${repo.owner}/${repo.name}`;
}

/**
 * List pending collaborator invitations for a repository via
 * GET /repos/{owner}/{repo}/invitations.
 */
export async function listRepoInvitations(
  api: GitHubApi,
  input: { owner: string; repo: string },
): Promise<GitHubRepoInvitation[]> {
  try {
    return await api.listRepoInvitations(input);
  } catch (error) {
    throw toGitHubIntegrationError(error, `listRepoInvitations(${input.owner}/${input.repo})`);
  }
}

/**
 * Cancel a pending repository invitation via
 * DELETE /repos/{owner}/{repo}/invitations/{invitation_id}. A 404 is treated as
 * success because the invitation may already have been accepted or expired.
 */
export async function cancelInvitation(
  api: GitHubApi,
  input: { owner: string; repo: string; invitationId: number },
): Promise<void> {
  try {
    await api.cancelRepoInvitation(input);
  } catch (error) {
    if ((error as { status?: number }).status === 404) return;
    throw toGitHubIntegrationError(error, `cancelInvitation(${input.owner}/${input.repo}#${input.invitationId})`);
  }
}

/**
 * Find the pending invitation for a specific user on a repo, if one exists.
 * Useful for resolving an `invitationId` when re-syncing access state.
 */
export async function findPendingInvitation(
  api: GitHubApi,
  input: { owner: string; repo: string; username: string },
): Promise<GitHubRepoInvitation | undefined> {
  const invitations = await listRepoInvitations(api, { owner: input.owner, repo: input.repo });
  const target = input.username.toLowerCase();
  return invitations.find((invitation) => invitation.inviteeLogin.toLowerCase() === target);
}
