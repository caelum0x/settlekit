/**
 * Repository permission levels accepted by GitHub's add-collaborator endpoint.
 * `pull` = read, `push` = write, `triage`/`maintain`/`admin` are elevated.
 */
export type GitHubRepoPermission = "pull" | "triage" | "push" | "maintain" | "admin";

/** Effective permission GitHub reports for an existing collaborator. */
export type GitHubCollaboratorPermission = "none" | "read" | "triage" | "write" | "maintain" | "admin";

/** Role of a member within an organization team. */
export type GitHubTeamRole = "member" | "maintainer";

export interface GitHubRepository {
  id: number;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
}

export interface GitHubTeam {
  id: number;
  orgLogin: string;
  slug: string;
  name: string;
}

/** Result of looking up a GitHub user by login. */
export interface GitHubUser {
  id: number;
  login: string;
}

/** Result of a verifyGithubUsername call. */
export interface GitHubUsernameVerification {
  exists: boolean;
  user?: GitHubUser;
}

/**
 * Narrow, high-level client used by the access granter / revoker / sync logic.
 * Tests provide an in-memory implementation of this interface; the production
 * implementation (`createGitHubAccessClient`) is backed by real Octokit calls.
 */
export interface GitHubAccessClient {
  inviteRepoCollaborator(input: {
    installationId: number;
    owner: string;
    repo: string;
    username: string;
    permission?: "pull" | "push" | "maintain";
  }): Promise<{ invitationId?: number }>;
  removeRepoCollaborator(input: { installationId: number; owner: string; repo: string; username: string }): Promise<void>;
  addTeamMembership(input: { installationId: number; orgLogin: string; teamSlug: string; username: string }): Promise<void>;
  removeTeamMembership(input: { installationId: number; orgLogin: string; teamSlug: string; username: string }): Promise<void>;
  getRepoCollaboratorPermission(input: {
    installationId: number;
    owner: string;
    repo: string;
    username: string;
  }): Promise<"none" | "read" | "write" | "admin">;
}

export interface GrantRepoAccessInput {
  organizationId: string;
  installationId: number;
  customerId: string;
  entitlementId: string;
  repoOwner: string;
  repoName: string;
  githubUsername: string;
  permission?: "pull" | "push" | "maintain";
}

export interface RevokeRepoAccessInput {
  installationId: number;
  repoOwner: string;
  repoName: string;
  githubUsername: string;
}

export interface AddToTeamInput {
  org: string;
  teamSlug: string;
  username: string;
  role?: GitHubTeamRole;
}

export interface RemoveFromTeamInput {
  org: string;
  teamSlug: string;
  username: string;
}

/** A repository pending invitation as returned by the GitHub REST API. */
export interface GitHubRepoInvitation {
  id: number;
  inviteeLogin: string;
  permissions: string;
}

/**
 * The expected end-state for a single collaborator, used by `syncAccess` to
 * reconcile what GitHub actually reports against what entitlements require.
 */
export interface ExpectedRepoAccess {
  grant: import("@settlekit/common").GitHubRepoAccessGrant;
  /** When true the grant has expired and access must be revoked. */
  expired?: boolean;
}

/** Per-grant outcome produced by a sync run. */
export interface GitHubAccessSyncOutcome {
  grantId: string;
  githubUsername: string;
  repoOwner: string;
  repoName: string;
  action: "noop" | "activated" | "reinvited" | "revoked";
  grant: import("@settlekit/common").GitHubRepoAccessGrant;
  error?: string;
}

/** Aggregate result of reconciling a batch of expected grants. */
export interface GitHubAccessSyncRun {
  startedAt: string;
  finishedAt: string;
  total: number;
  activated: number;
  reinvited: number;
  revoked: number;
  failed: number;
  outcomes: GitHubAccessSyncOutcome[];
}
