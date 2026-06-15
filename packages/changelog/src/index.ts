export type ChangelogCategory = "feature" | "fix" | "security" | "docs";

export interface ChangelogEntry {
  version: string;
  title: string;
  category: ChangelogCategory;
  publishedAt: string;
}

export function createChangelogEntry(input: Omit<ChangelogEntry, "publishedAt">, now = new Date()): ChangelogEntry {
  return { ...input, publishedAt: now.toISOString() };
}

export function latestChangelog(entries: ChangelogEntry[]): ChangelogEntry | undefined {
  return [...entries].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
}
