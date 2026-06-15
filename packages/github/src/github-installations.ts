import type { GitHubInstallation } from "@settlekit/common";
import type { GitHubApi } from "./github-app-client.js";
import { toGitHubIntegrationError } from "./github-errors.js";
import type { GitHubRepository } from "./types.js";

export function isOrganizationInstallation(installation: GitHubInstallation): boolean {
  return installation.accountType === "Organization";
}

/**
 * List every repository the installation can access via
 * GET /installation/repositories. Errors are surfaced as `integration_error`.
 */
export async function listInstallationRepositories(api: GitHubApi): Promise<GitHubRepository[]> {
  try {
    return await api.listInstallationRepositories();
  } catch (error) {
    throw toGitHubIntegrationError(error, "listInstallationRepositories");
  }
}
