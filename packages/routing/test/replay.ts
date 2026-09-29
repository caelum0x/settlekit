/**
 * Replays provider responses recorded from the live APIs on 2026-09-29
 * (api.relay.link /quote + /intents/status/v3, li.quest /quote/toAmount +
 * /status). Tests never touch the network.
 *
 * Quotes were taken with throwaway addresses (user 0x5b1e…4567, recipient
 * 0x1f2e…c7d6, Solana recipient 9WzD…AWWM) for small amounts; statuses are
 * real requests observed on Relay/LI.FI (success/refund/failure/waiting).
 * `base-relay-fill.json` is the Base receipt (USDC token logs only) of the
 * destination fill of Relay request 0x17906918…e335, in the
 * @settlekit/chains fixture format.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "../src/index.js";

export function fixture(provider: "relay" | "lifi", name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${provider}/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ReplayRoute {
  match: (url: string, method: string) => boolean;
  status?: number;
  body: unknown;
}

/** A fetch that answers from `routes` (first match) and records every call. */
export function replayFetch(routes: readonly ReplayRoute[]): FetchLike & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url: input,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const route = routes.find((entry) => entry.match(input, method));
    if (route === undefined) throw new Error(`no recorded response for ${method} ${input}`);
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { "content-type": "application/json" } });
  }) as FetchLike & { calls: Recorded[] };
  fetchImpl.calls = calls;
  return fetchImpl;
}
