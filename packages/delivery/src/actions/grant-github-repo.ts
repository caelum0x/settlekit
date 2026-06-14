import type { DeliveryHandler } from "../types.js";

export const grantGitHubRepo: DeliveryHandler = async (action, context) => {
  if (action.type !== "github_invite") throw new Error("invalid action");
  return { repoId: action.repoId, githubUsername: context.collectedFields?.githubUsername };
};
