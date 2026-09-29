/**
 * REAL Discord role delivery for paid checkouts.
 *
 *   DISCORD_BOT_TOKEN      the seller-installed bot (needs Manage Roles, with its
 *                          role ABOVE the role it grants)
 *   DISCORD_CLIENT_ID      OAuth2 app, so buyers connect Discord instead of
 *   DISCORD_CLIENT_SECRET  pasting a user id (identify + guilds.join)
 *
 * After payment the bot calls PUT /guilds/{guild}/members/{user}/roles/{role}
 * (`@settlekit/discord` createDiscordClient). Without a bot token the outcome
 * is `pending_setup`: the buyer is told the role is pending and the worker's
 * discord-delivery-retry job grants it once the bot is configured. A role is
 * never reported as granted unless Discord accepted it.
 */
import { createDiscordClient, grantDiscordRole, type DiscordApi } from "@settlekit/discord";
import type { DeliveryAction, DiscordRoleGrant, Payment, Product } from "@settlekit/common";

type Env = Readonly<Record<string, string | undefined>>;

export type DiscordAction = Extract<DeliveryAction, { type: "discord_role_add" }>;

export type DiscordDelivery = { ok: true; api: DiscordApi; botToken: string } | { ok: false; error: string };

export type DiscordDeliveryOutcome =
  | { status: "delivered"; target: string; grant: DiscordRoleGrant }
  | { status: "pending_setup"; reason: string }
  | { status: "failed"; reason: string };

const PENDING_SETUP_REASON = "The merchant has not connected the SettleKit Discord bot yet (DISCORD_BOT_TOKEN).";
const SNOWFLAKE = /^\d{15,21}$/;

let cached: { token: string; delivery: DiscordDelivery } | undefined;

export function getDiscordDelivery(env: Env = process.env): DiscordDelivery {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: PENDING_SETUP_REASON };
  if (cached?.token !== token) {
    cached = { token, delivery: { ok: true, botToken: token, api: createDiscordClient({ botToken: token, auditReason: "SettleKit paid access" }) } };
  }
  return cached.delivery;
}

export function isDiscordAction(action: DeliveryAction): action is DiscordAction {
  return action.type === "discord_role_add";
}

/** Guild + role from the action or the product settings; undefined when not configured. */
export function resolveDiscordTarget(action: DiscordAction, product: Product): { guildId: string; roleId: string } | undefined {
  const meta = product.metadata ?? {};
  const guildId = SNOWFLAKE.test(action.guildId) ? action.guildId : typeof meta.guildId === "string" ? meta.guildId : "";
  const roleId = SNOWFLAKE.test(action.roleId) ? action.roleId : typeof meta.roleId === "string" ? meta.roleId : "";
  return SNOWFLAKE.test(guildId) && SNOWFLAKE.test(roleId) ? { guildId, roleId } : undefined;
}

export interface DeliverDiscordInput {
  discord: DiscordDelivery;
  action: DiscordAction;
  product: Product;
  payment: Payment;
  entitlementId: string;
  discordUserId: string;
}

/** Add the paid role. Never throws: failures become outcomes. */
export async function deliverDiscordRole(input: DeliverDiscordInput): Promise<DiscordDeliveryOutcome> {
  if (!input.discord.ok) return { status: "pending_setup", reason: input.discord.error };
  const userId = input.discordUserId.trim();
  if (!SNOWFLAKE.test(userId)) return { status: "failed", reason: "No Discord account was connected at checkout." };
  const target = resolveDiscordTarget(input.action, input.product);
  if (!target) return { status: "failed", reason: "The product has no Discord server and role configured." };
  // PUT /guilds/{guild}/members/{user}/roles/{role}; a Discord error comes back as a `failed` grant.
  const grant = await grantDiscordRole(input.discord.api, {
    organizationId: input.payment.organizationId,
    guildId: target.guildId,
    roleId: target.roleId,
    customerId: input.payment.customerId,
    entitlementId: input.entitlementId,
    discordUserId: userId,
  });
  if (grant.status === "active") return { status: "delivered", target: `${target.guildId}/${target.roleId}`, grant };
  return { status: "failed", reason: "Discord refused the role (the buyer may need to join the server, or the bot role is below the paid role)." };
}

/**
 * Put the buyer in the guild with their OAuth token (guilds.join) so the role
 * can be added after payment. Joining grants no paid role. Best effort.
 */
export async function joinGuild(delivery: DiscordDelivery, guildId: string, userId: string, accessToken: string): Promise<boolean> {
  if (!delivery.ok || !SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) return false;
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
      method: "PUT",
      headers: { authorization: `Bot ${delivery.botToken}`, "content-type": "application/json" },
      body: JSON.stringify({ access_token: accessToken }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
