/**
 * Delivery actions for an agent purchase (derivation shared with the worker
 * via `@settlekit/delivery` `deliveryActionsFor`). Actions that need a buyer identity
 * (GitHub login, Discord user, email) report it as a required field so the
 * API can reject the request BEFORE any payment is settled.
 */
import type { DeliveryAction } from "@settlekit/common";
import { deliveryActionsFor } from "@settlekit/delivery";

export { deliveryActionsFor };

export type BuyerField = "githubUsername" | "discordUserId" | "email";

/** Buyer fields the actions need to execute. */
export function requiredBuyerFields(actions: readonly DeliveryAction[]): BuyerField[] {
  const fields = new Set<BuyerField>();
  for (const action of actions) {
    if (action.type === "github_invite" || action.type === "github_team_add") fields.add("githubUsername");
    if (action.type === "discord_role_add") fields.add("discordUserId");
    if (action.type === "email_send") fields.add("email");
  }
  return [...fields];
}
