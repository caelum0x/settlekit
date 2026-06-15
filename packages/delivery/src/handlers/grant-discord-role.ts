/**
 * `discord_role_add` handler: assign a Discord role to the purchaser via the
 * injected DiscordRoleClient.
 */

import { SettleKitError } from "@settlekit/common";
import type { ActionHandler, ActionOfType, ActionOutput, DeliveryContext } from "../types.js";

type Action = ActionOfType<"discord_role_add">;

export function grantDiscordRoleHandler(): ActionHandler<Action> {
  return {
    type: "discord_role_add",

    async execute(action: Action, ctx: DeliveryContext): Promise<ActionOutput> {
      const { discordUserId } = ctx;
      if (!discordUserId) {
        throw new SettleKitError({
          code: "validation_error",
          message: "Customer has no linked Discord account; cannot assign role",
          details: { customerId: ctx.customerId },
        });
      }

      const grant = await ctx.clients.discord.addRole({
        organizationId: ctx.organizationId,
        customerId: ctx.customerId,
        entitlementId: ctx.entitlementId,
        guildId: action.guildId,
        roleId: action.roleId,
        discordUserId,
      });

      return {
        grantId: grant.id,
        guildId: action.guildId,
        roleId: action.roleId,
        discordUserId: grant.discordUserId,
        status: grant.status,
      };
    },

    async rollback(action: Action, output: ActionOutput, ctx: DeliveryContext): Promise<void> {
      const discordUserId = stringOrUndefined(output.discordUserId) ?? ctx.discordUserId;
      if (!discordUserId) return;
      await ctx.clients.discord.removeRole({
        guildId: action.guildId,
        roleId: action.roleId,
        discordUserId,
      });
    },
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
