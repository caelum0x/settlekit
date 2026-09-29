/**
 * In-process fixed-window attempt limiter for login and onboarding. It is a
 * per-instance speed bump (the API has its own limits), returning new state
 * instead of mutating shared structures in place.
 */
export interface Window {
  readonly start: number;
  readonly count: number;
}

export interface Limiter {
  /** Records an attempt; false when the key is over its budget. */
  hit(key: string, now?: number): boolean;
}

export function createLimiter(max: number, windowMs: number): Limiter {
  let windows: ReadonlyMap<string, Window> = new Map();
  return {
    hit(key, now = Date.now()) {
      const live = new Map([...windows].filter(([, w]) => now - w.start < windowMs));
      const current = live.get(key);
      const next: Window = current ? { start: current.start, count: current.count + 1 } : { start: now, count: 1 };
      windows = new Map([...live, [key, next]]);
      return next.count <= max;
    },
  };
}

/** Best-effort client key from proxy headers. */
export function clientKey(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
