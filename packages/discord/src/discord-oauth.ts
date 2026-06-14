import { URL } from "node:url";

export function buildDiscordOAuthUrl(clientId: string, redirectUri: string, state: string, scopes = ["identify", "guilds"]): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}
