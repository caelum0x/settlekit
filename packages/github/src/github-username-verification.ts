const USERNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

export function isValidGitHubUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}
