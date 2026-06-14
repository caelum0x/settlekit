import type { GitHubInstallation } from "@settlekit/common";

export function isOrganizationInstallation(installation: GitHubInstallation): boolean {
  return installation.accountType === "Organization";
}
