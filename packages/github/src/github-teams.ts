import type { GitHubTeam } from "./types.js";

export function formatTeamName(team: GitHubTeam): string {
  return `${team.orgLogin}/${team.slug}`;
}
