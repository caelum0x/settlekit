export interface RateLimitWindow {
  key: string;
  limit: number;
  used: number;
  resetsAt: string;
}

export function rateLimitAllows(window: RateLimitWindow, cost = 1, now = new Date()): boolean {
  if (new Date(window.resetsAt).getTime() <= now.getTime()) return true;
  return window.used + cost <= window.limit;
}

export function consumeRateLimit(window: RateLimitWindow, cost = 1): RateLimitWindow {
  if (!rateLimitAllows(window, cost)) throw new Error("rate limit exceeded");
  return { ...window, used: window.used + cost };
}
