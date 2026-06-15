/**
 * `github_invite` handler: invite the purchaser to a private repo as a
 * collaborator with the requested permission, via the injected GithubAccessClient.
 */

import { SettleKitError } from "@settlekit/common";
import type { ActionHandler, ActionOfType, ActionOutput, DeliveryContext } from "../types.js";

type Action = ActionOfType<"github_invite">;

export function grantGithubRepoHandler(): ActionHandler<Action> {
  return {
    type: "github_invite",

    async execute(action: Action, ctx: DeliveryContext): Promise<ActionOutput> {
      const { githubInstallationId, githubUsername } = ctx;
      if (githubInstallationId === undefined) {
        throw new SettleKitError({
          code: "integration_error",
          message: "GitHub installation is not connected for this organization",
          details: { organizationId: ctx.organizationId },
        });
      }
      if (!githubUsername) {
        throw new SettleKitError({
          code: "validation_error",
          message: "Customer has no linked GitHub username; cannot grant repo access",
          details: { customerId: ctx.customerId },
        });
      }

      // The repoId is "owner/name" as stored on the delivery action.
      const { repoOwner, repoName } = parseRepoId(action.repoId);
      const permission = action.permission ?? "pull";

      const grant = await ctx.clients.github.inviteCollaborator({
        organizationId: ctx.organizationId,
        customerId: ctx.customerId,
        entitlementId: ctx.entitlementId,
        installationId: githubInstallationId,
        repoOwner,
        repoName,
        githubUsername,
        permission,
      });

      return {
        grantId: grant.id,
        invitationId: grant.invitationId ?? null,
        repoOwner: grant.repoOwner,
        repoName: grant.repoName,
        githubUsername: grant.githubUsername,
        status: grant.status,
        permission,
        installationId: githubInstallationId,
      };
    },

    async rollback(action: Action, output: ActionOutput, ctx: DeliveryContext): Promise<void> {
      const installationId = numberOrUndefined(output.installationId) ?? ctx.githubInstallationId;
      const githubUsername = stringOrUndefined(output.githubUsername) ?? ctx.githubUsername;
      if (installationId === undefined || !githubUsername) return;

      const { repoOwner, repoName } = parseRepoId(action.repoId);
      await ctx.clients.github.removeCollaborator({
        installationId,
        repoOwner,
        repoName,
        githubUsername,
        invitationId: numberOrUndefined(output.invitationId),
      });
    },
  };
}

function parseRepoId(repoId: string): { repoOwner: string; repoName: string } {
  const slash = repoId.indexOf("/");
  if (slash <= 0 || slash === repoId.length - 1) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Invalid GitHub repoId "${repoId}"; expected "owner/name"`,
      details: { repoId },
    });
  }
  return { repoOwner: repoId.slice(0, slash), repoName: repoId.slice(slash + 1) };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
