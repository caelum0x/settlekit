/**
 * "Connect Discord" at checkout (OAuth2 authorization code flow).
 *
 *   /api/discord/authorize?session=<id>  -> Discord consent (identify + guilds.join)
 *   /api/discord/callback               -> exchange the code, read /users/@me,
 *                                          save discordUserId / discordUsername on
 *                                          the session, join the buyer to the
 *                                          product's server, back to the checkout
 *
 * `state` is an HMAC-signed (session id, expiry) pair, so a callback can only
 * write to the session that started it and only within ten minutes.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DISCORD_API_BASE, buildDiscordOAuthUrl, exchangeOAuthCode } from "@settlekit/discord";

type Env = Readonly<Record<string, string | undefined>>;

const STATE_TTL_MS = 10 * 60_000;
const SCOPES = ["identify", "guilds.join"] as const;

export interface DiscordOAuthSetup {
  clientId: string;
  clientSecret: string;
}

export function discordOAuthSetup(env: Env = process.env): DiscordOAuthSetup | null {
  const clientId = env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function stateSecret(env: Env = process.env): string {
  return env.CHECKOUT_MANAGE_SECRET?.trim() || env.CHECKOUT_DELIVERY_SECRET?.trim() || env.DISCORD_CLIENT_SECRET?.trim() || "settlekit-dev-discord-state";
}

function sign(payload: string): string {
  return createHmac("sha256", stateSecret()).update(`discord:${payload}`).digest("base64url");
}

export function createState(sessionId: string, now: Date = new Date()): string {
  const payload = Buffer.from(JSON.stringify({ s: sessionId, e: now.getTime() + STATE_TTL_MS, n: randomBytes(6).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readState(state: string, now: Date = new Date()): string | null {
  const [payload, mac, extra] = state.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { s?: unknown; e?: unknown };
    if (typeof parsed.s !== "string" || typeof parsed.e !== "number" || parsed.e < now.getTime()) return null;
    return parsed.s;
  } catch {
    return null;
  }
}

export function redirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/discord/callback`;
}

export function authorizeUrl(setup: DiscordOAuthSetup, origin: string, sessionId: string): string {
  return buildDiscordOAuthUrl(setup.clientId, redirectUri(origin), createState(sessionId), SCOPES);
}

export interface DiscordIdentity {
  userId: string;
  username: string;
  accessToken: string;
}

/** Exchange the code and read the buyer's Discord identity. */
export async function identify(setup: DiscordOAuthSetup, origin: string, code: string): Promise<DiscordIdentity> {
  const token = await exchangeOAuthCode({ ...setup, redirectUri: redirectUri(origin) }, code);
  const res = await fetch(`${DISCORD_API_BASE}/users/@me`, { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!res.ok) throw new Error(`Discord did not return your account (${res.status}).`);
  const user = (await res.json()) as { id?: string; username?: string; global_name?: string | null };
  if (!user.id) throw new Error("Discord did not return your account id.");
  return { userId: user.id, username: user.global_name || user.username || user.id, accessToken: token.access_token };
}
