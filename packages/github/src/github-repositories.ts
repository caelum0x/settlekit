import type { GitHubRepository } from "./types.js";

export function formatRepositoryName(repo: Pick<GitHubRepository, "owner" | "name">): string {
  return `${repo.owner}/${repo.name}`;
}
