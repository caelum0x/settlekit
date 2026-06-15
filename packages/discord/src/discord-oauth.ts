import { validationError } from "@settlekit/common";
import type {
  RESTGetAPICurrentUserResult,
  RESTPostOAuth2AccessTokenResult,
} from "discord-api-types/v10";
import {
  DISCORD_API_BASE,
  DISCORD_OAUTH_AUTHORIZE_URL,
  DISCORD_OAUTH_TOKEN_URL,
} from "./types.js";
import { toDiscordError, toDiscordTransportError, type DiscordErrorBody } from "./discord-errors.js";

/** Access-token response returned by Discord's OAuth2 token endpoint. */
export type DiscordOAuthTokenResult = RESTPostOAuth2AccessTokenResult;

/** Credentials and endpoints needed for the Discord OAuth2 code flow. */
export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Injectable fetch (defaults to the global `fetch`). */
  fetch?: typeof fetch;
  /** Override the token endpoint (defaults to {@link DISCORD_OAUTH_TOKEN_URL}). */
  tokenUrl?: string;
  /** Override the API base for the identity lookup. */
  baseUrl?: string;
}

/**
 * Build the authorize URL users are redirected to. Default scopes
 * (`identify`, `guilds.join`) are the minimum needed to resolve a user id and
 * add them to a guild.
 */
export function buildDiscordOAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scopes: readonly string[] = ["identify", "guilds.join"],
): string {
  const url = new URL(DISCORD_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchange an authorization `code` for an access token via
 * `POST /oauth2/token` (application/x-www-form-urlencoded).
 */
export async function exchangeOAuthCode(
  config: DiscordOAuthConfig,
  code: string,
): Promise<DiscordOAuthTokenResult> {
  if (!config.clientId || !config.clientSecret) {
    throw validationError("exchangeOAuthCode: clientId and clientSecret are required");
  }
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });

  let response: Response;
  try {
    response = await fetchImpl(config.tokenUrl ?? DISCORD_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (error) {
    throw toDiscordTransportError(error, "discord.exchangeOAuthCode");
  }
  if (!response.ok) {
    const errorBody = await safeJson(response);
    throw toDiscordError(
      response.status,
      errorBody,
      "discord.exchangeOAuthCode",
      response.headers.get("retry-after"),
    );
  }
  return (await response.json()) as DiscordOAuthTokenResult;
}

/**
 * Resolve the authenticated user's id from an OAuth access token via
 * `GET /users/@me` (`Authorization: Bearer <accessToken>`).
 */
export async function resolveUserId(
  accessToken: string,
  config: Pick<DiscordOAuthConfig, "fetch" | "baseUrl"> = {},
): Promise<string> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const baseUrl = config.baseUrl ?? DISCORD_API_BASE;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/users/@me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    throw toDiscordTransportError(error, "discord.resolveUserId");
  }
  if (!response.ok) {
    const errorBody = await safeJson(response);
    throw toDiscordError(
      response.status,
      errorBody,
      "discord.resolveUserId",
      response.headers.get("retry-after"),
    );
  }
  const user = (await response.json()) as RESTGetAPICurrentUserResult;
  return user.id;
}

async function safeJson(response: Response): Promise<DiscordErrorBody | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    return JSON.parse(text) as DiscordErrorBody;
  } catch {
    return undefined;
  }
}
