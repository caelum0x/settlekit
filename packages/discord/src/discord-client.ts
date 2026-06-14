export interface DiscordClientOptions {
  botTokenRef: string;
  applicationId: string;
}

export function assertDiscordClientOptions(options: DiscordClientOptions): DiscordClientOptions {
  if (!options.botTokenRef || !options.applicationId) throw new Error("botTokenRef and applicationId are required");
  return options;
}
