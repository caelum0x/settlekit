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
