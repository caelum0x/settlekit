import type { DeliveryHandler } from "../types.js";

export const grantDiscordRole: DeliveryHandler = async (action, context) => {
  if (action.type !== "discord_role_add") throw new Error("invalid action");
  return { guildId: action.guildId, roleId: action.roleId, discordUserId: context.collectedFields?.discordUserId };
};
