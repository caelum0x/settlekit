export interface GitHubAppClientOptions {
  appId: string;
  privateKey: string;
  webhookSecret?: string;
}

export function createGitHubAppClientOptions(options: GitHubAppClientOptions): GitHubAppClientOptions {
  if (!options.appId || !options.privateKey) throw new Error("appId and privateKey are required");
  return options;
}
