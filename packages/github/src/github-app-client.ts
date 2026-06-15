import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { validationError } from "@settlekit/common";
import type {
  GitHubAccessClient,
  GitHubCollaboratorPermission,
  GitHubRepoInvitation,
  GitHubRepository,
  GitHubTeam,
  GitHubTeamRole,
  GitHubUser,
} from "./types.js";

/** Collapse GitHub's granular permission scale into the 4 levels we track. */
function normalizeCollaboratorPermission(
  permission: GitHubCollaboratorPermission,
): "none" | "read" | "write" | "admin" {
  switch (permission) {
    case "admin":
      return "admin";
    case "maintain":
    case "write":
      return "write";
    case "triage":
    case "read":
      return "read";
    case "none":
    default:
      return "none";
  }
}

/** Map the granter's coarse permission onto GitHub's collaborator permission. */
function toRepoPermission(permission: "pull" | "push" | "maintain" | undefined): string {
  return permission ?? "pull";
}

export interface GitHubAppClientOptions {
  /** Numeric GitHub App id (string form accepted, coerced to number). */
  appId: string | number;
  /** PEM-encoded private key for the GitHub App. */
  privateKey: string;
  /** Installation id to scope all requests to a single account. */
  installationId: number;
  /** Optional override of the GitHub REST base URL (for GHE). */
  baseUrl?: string;
}

/**
 * The exact slice of the GitHub REST API this package depends on. Production
 * code uses `OctokitGitHubApi`; tests can implement this interface in memory to
 * drive higher-level logic without network access.
 */
export interface GitHubApi {
  /** GET /installation/repositories */
  listInstallationRepositories(): Promise<GitHubRepository[]>;
  /** GET /orgs/{org}/teams */
  listOrgTeams(org: string): Promise<GitHubTeam[]>;
  /** GET /users/{username} — returns undefined on 404. */
  getUser(username: string): Promise<GitHubUser | undefined>;
  /** PUT /repos/{owner}/{repo}/collaborators/{username} */
  addRepoCollaborator(input: {
    owner: string;
    repo: string;
    username: string;
    permission: string;
  }): Promise<{ invitationId?: number }>;
  /** DELETE /repos/{owner}/{repo}/collaborators/{username} */
  removeRepoCollaborator(input: { owner: string; repo: string; username: string }): Promise<void>;
  /** GET /repos/{owner}/{repo}/collaborators/{username}/permission */
  getRepoCollaboratorPermission(input: {
    owner: string;
    repo: string;
    username: string;
  }): Promise<GitHubCollaboratorPermission>;
  /** GET /repos/{owner}/{repo}/invitations */
  listRepoInvitations(input: { owner: string; repo: string }): Promise<GitHubRepoInvitation[]>;
  /** DELETE /repos/{owner}/{repo}/invitations/{invitation_id} */
  cancelRepoInvitation(input: { owner: string; repo: string; invitationId: number }): Promise<void>;
  /** PUT /orgs/{org}/teams/{team_slug}/memberships/{username} */
  addTeamMembership(input: { org: string; teamSlug: string; username: string; role: GitHubTeamRole }): Promise<void>;
  /** DELETE /orgs/{org}/teams/{team_slug}/memberships/{username} */
  removeTeamMembership(input: { org: string; teamSlug: string; username: string }): Promise<void>;
}

/**
 * Build a real Octokit client authenticated as a GitHub App installation using
 * `createAppAuth`. Every request is signed with an installation access token,
 * which is exactly what is required for repo/team automation.
 */
export function createGitHubAppClient(options: GitHubAppClientOptions): Octokit {
  const appId = typeof options.appId === "string" ? Number(options.appId) : options.appId;
  if (!Number.isFinite(appId) || appId <= 0) {
    throw validationError("createGitHubAppClient: appId must be a positive number");
  }
  if (!options.privateKey || options.privateKey.trim().length === 0) {
    throw validationError("createGitHubAppClient: privateKey is required");
  }
  if (!Number.isFinite(options.installationId) || options.installationId <= 0) {
    throw validationError("createGitHubAppClient: installationId must be a positive number");
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey: options.privateKey,
      installationId: options.installationId,
    },
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
}

/**
 * Real `GitHubApi` implementation backed by an authenticated Octokit instance.
 * Each method maps directly onto a documented REST endpoint.
 */
export class OctokitGitHubApi implements GitHubApi {
  constructor(private readonly octokit: Octokit) {}

  /** Construct directly from GitHub App credentials. */
  static fromAppCredentials(options: GitHubAppClientOptions): OctokitGitHubApi {
    return new OctokitGitHubApi(createGitHubAppClient(options));
  }

  async listInstallationRepositories(): Promise<GitHubRepository[]> {
    const repos = await this.octokit.paginate(this.octokit.apps.listReposAccessibleToInstallation, {
      per_page: 100,
    });
    return repos.map((repo) => ({
      id: repo.id,
      owner: repo.owner.login,
      name: repo.name,
      private: repo.private,
      defaultBranch: repo.default_branch,
    }));
  }

  async listOrgTeams(org: string): Promise<GitHubTeam[]> {
    const teams = await this.octokit.paginate(this.octokit.teams.list, { org, per_page: 100 });
    return teams.map((team) => ({
      id: team.id,
      orgLogin: org,
      slug: team.slug,
      name: team.name,
    }));
  }

  async getUser(username: string): Promise<GitHubUser | undefined> {
    try {
      const { data } = await this.octokit.users.getByUsername({ username });
      return { id: data.id, login: data.login };
    } catch (error) {
      if ((error as { status?: number }).status === 404) return undefined;
      throw error;
    }
  }

  async addRepoCollaborator(input: {
    owner: string;
    repo: string;
    username: string;
    permission: string;
  }): Promise<{ invitationId?: number }> {
    const { data, status } = await this.octokit.repos.addCollaborator({
      owner: input.owner,
      repo: input.repo,
      username: input.username,
      permission: input.permission,
    });
    // 201 returns an invitation object; 204 means the user already had access.
    if (status === 201 && data && typeof data === "object" && "id" in data) {
      return { invitationId: (data as { id: number }).id };
    }
    return {};
  }

  async removeRepoCollaborator(input: { owner: string; repo: string; username: string }): Promise<void> {
    await this.octokit.repos.removeCollaborator(input);
  }

  async getRepoCollaboratorPermission(input: {
    owner: string;
    repo: string;
    username: string;
  }): Promise<GitHubCollaboratorPermission> {
    const { data } = await this.octokit.repos.getCollaboratorPermissionLevel(input);
    return data.permission as GitHubCollaboratorPermission;
  }

  async listRepoInvitations(input: { owner: string; repo: string }): Promise<GitHubRepoInvitation[]> {
    const invitations = await this.octokit.paginate(this.octokit.repos.listInvitations, {
      owner: input.owner,
      repo: input.repo,
      per_page: 100,
    });
    return invitations.map((invitation) => ({
      id: invitation.id,
      inviteeLogin: invitation.invitee?.login ?? "",
      permissions: invitation.permissions,
    }));
  }

  async cancelRepoInvitation(input: { owner: string; repo: string; invitationId: number }): Promise<void> {
    await this.octokit.repos.deleteInvitation({
      owner: input.owner,
      repo: input.repo,
      invitation_id: input.invitationId,
    });
  }

  async addTeamMembership(input: {
    org: string;
    teamSlug: string;
    username: string;
    role: GitHubTeamRole;
  }): Promise<void> {
    await this.octokit.teams.addOrUpdateMembershipForUserInOrg({
      org: input.org,
      team_slug: input.teamSlug,
      username: input.username,
      role: input.role,
    });
  }

  async removeTeamMembership(input: { org: string; teamSlug: string; username: string }): Promise<void> {
    await this.octokit.teams.removeMembershipForUserInOrg({
      org: input.org,
      team_slug: input.teamSlug,
      username: input.username,
    });
  }
}

/**
 * Adapt a low-level {@link GitHubApi} into the high-level {@link GitHubAccessClient}
 * consumed by the granter / revoker / sync logic. This is the production default
 * implementation of `GitHubAccessClient` — it makes real GitHub REST calls via
 * the supplied `GitHubApi`. The `installationId` carried on each call is purely
 * informational here because `api` is already scoped to one installation.
 */
export function createGitHubAccessClient(api: GitHubApi): GitHubAccessClient {
  return {
    async inviteRepoCollaborator(input) {
      return api.addRepoCollaborator({
        owner: input.owner,
        repo: input.repo,
        username: input.username,
        permission: toRepoPermission(input.permission),
      });
    },
    async removeRepoCollaborator(input) {
      await api.removeRepoCollaborator({ owner: input.owner, repo: input.repo, username: input.username });
    },
    async addTeamMembership(input) {
      await api.addTeamMembership({
        org: input.orgLogin,
        teamSlug: input.teamSlug,
        username: input.username,
        role: "member",
      });
    },
    async removeTeamMembership(input) {
      await api.removeTeamMembership({ org: input.orgLogin, teamSlug: input.teamSlug, username: input.username });
    },
    async getRepoCollaboratorPermission(input) {
      const permission = await api.getRepoCollaboratorPermission({
        owner: input.owner,
        repo: input.repo,
        username: input.username,
      });
      return normalizeCollaboratorPermission(permission);
    },
  };
}
