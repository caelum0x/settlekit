import type { GitHubApi } from "./github-app-client.js";
import { toGitHubIntegrationError } from "./github-errors.js";
import type { AddToTeamInput, GitHubTeam, RemoveFromTeamInput } from "./types.js";

export function formatTeamName(team: GitHubTeam): string {
  return `${team.orgLogin}/${team.slug}`;
}

/** List all teams in an organization via GET /orgs/{org}/teams. */
export async function listOrgTeams(api: GitHubApi, org: string): Promise<GitHubTeam[]> {
  try {
    return await api.listOrgTeams(org);
  } catch (error) {
    throw toGitHubIntegrationError(error, `listOrgTeams(${org})`);
  }
}

/**
 * Add (or update) a user's team membership via
 * PUT /orgs/{org}/teams/{team_slug}/memberships/{username}. Idempotent: GitHub
 * upserts the membership, so re-running with the same role is a no-op.
 */
export async function addToTeam(api: GitHubApi, input: AddToTeamInput): Promise<void> {
  try {
    await api.addTeamMembership({
      org: input.org,
      teamSlug: input.teamSlug,
      username: input.username,
      role: input.role ?? "member",
    });
  } catch (error) {
    throw toGitHubIntegrationError(error, `addToTeam(${input.org}/${input.teamSlug}:${input.username})`);
  }
}

/**
 * Remove a user from a team via
 * DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}. A 404 means the
 * membership is already gone, which we treat as success.
 */
export async function removeFromTeam(api: GitHubApi, input: RemoveFromTeamInput): Promise<void> {
  try {
    await api.removeTeamMembership({ org: input.org, teamSlug: input.teamSlug, username: input.username });
  } catch (error) {
    if ((error as { status?: number }).status === 404) return;
    throw toGitHubIntegrationError(error, `removeFromTeam(${input.org}/${input.teamSlug}:${input.username})`);
  }
}
