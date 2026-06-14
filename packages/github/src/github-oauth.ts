import { URL } from "node:url";

export interface GitHubOAuthConfig {
  clientId: string;
  redirectUri: string;
  scopes: string[];
}

export function buildGitHubOAuthUrl(config: GitHubOAuthConfig, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}
