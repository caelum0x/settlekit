/**
 * `github_team_add` handler: add the purchaser to an organization team via the
 * injected GithubAccessClient.
 */

import { SettleKitError } from "@settlekit/common";
import type { ActionHandler, ActionOfType, ActionOutput, DeliveryContext } from "../types.js";

type Action = ActionOfType<"github_team_add">;

export function grantGithubTeamHandler(): ActionHandler<Action> {
  return {
    type: "github_team_add",

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
          message: "Customer has no linked GitHub username; cannot add to team",
          details: { customerId: ctx.customerId },
        });
      }

      const grant = await ctx.clients.github.addTeamMembership({
        organizationId: ctx.organizationId,
        customerId: ctx.customerId,
        entitlementId: ctx.entitlementId,
        installationId: githubInstallationId,
        orgLogin: action.orgLogin,
        teamSlug: action.teamSlug,
        githubUsername,
      });

      return {
        grantId: grant.id,
        orgLogin: action.orgLogin,
        teamSlug: action.teamSlug,
        githubUsername: grant.githubUsername,
        status: grant.status,
        installationId: githubInstallationId,
      };
    },

    async rollback(action: Action, output: ActionOutput, ctx: DeliveryContext): Promise<void> {
      const installationId = numberOrUndefined(output.installationId) ?? ctx.githubInstallationId;
      const githubUsername = stringOrUndefined(output.githubUsername) ?? ctx.githubUsername;
      if (installationId === undefined || !githubUsername) return;

      await ctx.clients.github.removeTeamMembership({
        installationId,
        orgLogin: action.orgLogin,
        teamSlug: action.teamSlug,
        githubUsername,
      });
    },
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
