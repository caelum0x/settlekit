export class DiscordIntegrationError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "DiscordIntegrationError";
  }
}
