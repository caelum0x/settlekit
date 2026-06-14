export type GitHubWebhookEvent = "installation.created" | "installation.deleted" | "member.added" | "member.removed";

export function isGitHubWebhookEvent(value: string): value is GitHubWebhookEvent {
  return ["installation.created", "installation.deleted", "member.added", "member.removed"].includes(value);
}
