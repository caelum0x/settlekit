export type GitHubInviteStatus = "pending" | "accepted" | "expired" | "failed";

export function inviteNeedsFollowUp(status: GitHubInviteStatus): boolean {
  return status === "pending" || status === "failed";
}
