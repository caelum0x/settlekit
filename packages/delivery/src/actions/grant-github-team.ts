import type { DeliveryHandler } from "../types.js";

export const grantGitHubTeam: DeliveryHandler = async (action, context) => {
  if (action.type !== "github_team_add") throw new Error("invalid action");
  return { orgLogin: action.orgLogin, teamSlug: action.teamSlug, githubUsername: context.collectedFields?.githubUsername };
};
