// Shared, transport-neutral config. Safe to import from BOTH client and server
// components (no server-only dependencies live here), unlike `lib/api.ts` which
// reads the session cookie and is therefore server-only.

/** Base URL of the SettleKit API. */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** Public URL of the hosted checkout (payment links live at /l/<slug>). */
export const CHECKOUT_URL = (
  process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

/** Discord application id of the SettleKit bot (for the "add bot" link). */
export const DISCORD_CLIENT_ID = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID?.trim() ?? "";

/** Invite the bot with Manage Roles (268435456) to a seller's server. */
export function discordBotInviteUrl(guildId?: string): string | null {
  if (!DISCORD_CLIENT_ID) return null;
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", DISCORD_CLIENT_ID);
  url.searchParams.set("scope", "bot");
  url.searchParams.set("permissions", "268435456");
  if (guildId && /^\d{15,21}$/.test(guildId)) url.searchParams.set("guild_id", guildId);
  return url.toString();
}

/** The shareable payment link for a product slug. */
export function paymentLinkUrl(slug: string): string {
  return `${CHECKOUT_URL}/l/${slug}`;
}
