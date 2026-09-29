/** Recorded-response fetch doubles for zcash tests (no network). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "../src/quote.js";

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8")) as T;
}

export interface Route {
  status?: number;
  body?: unknown;
}

/** A fetch that serves `routes` by URL prefix and records requested URLs. */
export function routedFetch(routes: Record<string, Route>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string) => {
    calls.push(input);
    const match = Object.entries(routes).find(([prefix]) => input.startsWith(prefix));
    if (match === undefined) throw new Error(`unexpected request ${input}`);
    const status = match[1].status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => match[1].body ?? {} };
  }) as FetchLike & { calls: string[] };
  impl.calls = calls;
  return impl;
}
