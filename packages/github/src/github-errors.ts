export class GitHubIntegrationError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = "GitHubIntegrationError";
  }
}
