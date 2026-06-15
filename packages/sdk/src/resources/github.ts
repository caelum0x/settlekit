/**
 * GitHub integration resource client.
 *
 * Maps to `/v1/integrations/github` (installations / repositories / teams) and
 * `/v1/github/access` (grant / revoke / sync).
 */
import type { GitHubInstallation, GitHubRepoAccessGrant } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link GitHubResource.connectInstallation}. */
export interface ConnectGitHubInstallationInput {
  organizationId: string;
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
}

/** Input for {@link GitHubResource.grant}. */
export interface GrantGitHubAccessInput {
  organizationId: string;
  installationId: number;
  customerId: string;
  entitlementId: string;
  repoOwner: string;
  repoName: string;
  githubUsername: string;
  permission?: "pull" | "push" | "maintain";
}

/** A repository summary derived from recorded grants. */
export interface GitHubRepositorySummary {
  owner: string;
  name: string;
  fullName: string;
}

/** An org team summary. */
export interface GitHubTeamSummary {
  orgLogin: string;
  slug: string;
  name: string;
}

/** A single outcome from a grant reconciliation sync. */
export interface GitHubSyncOutcome {
  grantId: string;
  action: string;
}

/** Result of a grant reconciliation sync. */
export interface GitHubSyncResult {
  organizationId: string;
  outcomes: GitHubSyncOutcome[];
}

/** Client for GitHub integration + access endpoints. */
export class GitHubResource {
  constructor(private readonly http: HttpClient) {}

  /** Connect a GitHub App installation. */
  connectInstallation(
    input: ConnectGitHubInstallationInput,
    options?: RequestOptions,
  ): Promise<GitHubInstallation> {
    return this.http.post<GitHubInstallation>("/v1/integrations/github/installations", input, options);
  }

  /** List connected installations, optionally filtered by organization. */
  listInstallations(organizationId?: string, options?: RequestOptions): Promise<GitHubInstallation[]> {
    return this.http.get<GitHubInstallation[]>("/v1/integrations/github/installations", {
      ...options,
      query: { ...(organizationId !== undefined ? { organizationId } : {}) },
    });
  }

  /** List repositories visible to installations (derived from grants). */
  listRepositories(options?: RequestOptions): Promise<GitHubRepositorySummary[]> {
    return this.http.get<GitHubRepositorySummary[]>("/v1/integrations/github/repositories", options);
  }

  /** List org teams, optionally filtered by organization. */
  listTeams(organizationId?: string, options?: RequestOptions): Promise<GitHubTeamSummary[]> {
    return this.http.get<GitHubTeamSummary[]>("/v1/integrations/github/teams", {
      ...options,
      query: { ...(organizationId !== undefined ? { organizationId } : {}) },
    });
  }

  /** Grant a customer access to a private repo. */
  grant(input: GrantGitHubAccessInput, options?: RequestOptions): Promise<GitHubRepoAccessGrant> {
    return this.http.post<GitHubRepoAccessGrant>("/v1/github/access/grant", input, options);
  }

  /** Revoke a recorded repo access grant. */
  revoke(grantId: string, options?: RequestOptions): Promise<GitHubRepoAccessGrant> {
    return this.http.post<GitHubRepoAccessGrant>("/v1/github/access/revoke", { grantId }, options);
  }

  /** Reconcile pending invites that are now accepted, for an organization. */
  sync(organizationId: string, options?: RequestOptions): Promise<GitHubSyncResult> {
    return this.http.post<GitHubSyncResult>("/v1/github/access/sync", { organizationId }, options);
  }
}
