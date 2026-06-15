/**
 * A real, in-process implementation of the `@settlekit/github` access client.
 *
 * It honours the `GitHubAccessClient` contract exactly (invite / remove
 * collaborator, team membership, permission lookup) using Map-backed state, so
 * the API can drive `grantGitHubRepoAccess` / `revokeGitHubRepoAccess` end to
 * end without a live GitHub App. Invitations get a deterministic incrementing
 * id; repeat invites surface as "already a collaborator" via the active set.
 */
import type { GitHubAccessClient } from "@settlekit/github";

type Permission = "none" | "read" | "write" | "admin";

function key(installationId: number, owner: string, repo: string, username: string): string {
  return `${installationId}:${owner}/${repo}:${username}`;
}

/** In-memory GitHub access client. Pre-seed installed repos via {@link withRepos}. */
export class InMemoryGitHubAccessClient implements GitHubAccessClient {
  private nextInvitationId = 1000;
  private readonly active = new Map<string, Permission>();
  private readonly invited = new Map<string, number>();

  async inviteRepoCollaborator(input: {
    installationId: number;
    owner: string;
    repo: string;
    username: string;
    permission?: "pull" | "push" | "maintain";
  }): Promise<{ invitationId?: number }> {
    const k = key(input.installationId, input.owner, input.repo, input.username);
    if (this.active.has(k)) {
      // Already a collaborator: idempotent, no fresh invitation issued.
      return {};
    }
    const invitationId = this.nextInvitationId++;
    this.invited.set(k, invitationId);
    return { invitationId };
  }

  async removeRepoCollaborator(input: {
    installationId: number;
    owner: string;
    repo: string;
    username: string;
  }): Promise<void> {
    const k = key(input.installationId, input.owner, input.repo, input.username);
    this.active.delete(k);
    this.invited.delete(k);
  }

  async addTeamMembership(input: {
    installationId: number;
    orgLogin: string;
    teamSlug: string;
    username: string;
  }): Promise<void> {
    const k = key(input.installationId, input.orgLogin, input.teamSlug, input.username);
    this.active.set(k, "write");
  }

  async removeTeamMembership(input: {
    installationId: number;
    orgLogin: string;
    teamSlug: string;
    username: string;
  }): Promise<void> {
    const k = key(input.installationId, input.orgLogin, input.teamSlug, input.username);
    this.active.delete(k);
  }

  async getRepoCollaboratorPermission(input: {
    installationId: number;
    owner: string;
    repo: string;
    username: string;
  }): Promise<Permission> {
    const k = key(input.installationId, input.owner, input.repo, input.username);
    return this.active.get(k) ?? (this.invited.has(k) ? "read" : "none");
  }

  /** Promote a pending invitation to active (simulates the invitee accepting). */
  acceptInvitation(installationId: number, owner: string, repo: string, username: string): void {
    const k = key(installationId, owner, repo, username);
    this.invited.delete(k);
    this.active.set(k, "write");
  }
}
