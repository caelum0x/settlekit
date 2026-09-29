/**
 * Any-token routing configuration (shared by the checkout and the worker).
 *
 *   ROUTING_ENABLED           true | 1 turns any-token checkout on (default off)
 *   RELAY_API_URL             default https://api.relay.link
 *   RELAY_API_KEY             optional (higher Relay rate limits)
 *   LIFI_ENABLED              LI.FI fallback, default true when routing is on
 *   LIFI_API_URL / LIFI_API_KEY / LIFI_INTEGRATOR (default "settlekit")
 *   ROUTE_MAX_FEE_BPS         max route cost vs the amount owed (default 300 = 3%)
 *   ROUTE_MAX_SLIPPAGE_BPS    max slippage tolerance (default 100 = 1%)
 *   ROUTE_QUOTE_TTL_SEC       how long a quote is shown (default 120)
 *   ROUTE_ORIGIN_ALLOWLIST    "*" (default) or "chainId:token|token,chainId:*"
 *   ROUTE_APP_FEE_BPS         optional integrator fee (default 0, max 500)
 *   ROUTE_APP_FEE_RECIPIENT   0x address receiving the app fee (required when > 0)
 */

import { ChainConfigError, readEnv, readInt, type Env } from "@settlekit/chains";
import { createLifiProvider, LIFI_API_URL } from "./lifi.js";
import { DEFAULT_ROUTE_POLICY, type OriginRule, type RoutePolicy } from "./policy.js";
import { createRelayProvider, RELAY_API_URL } from "./relay.js";
import { createRouter, type Router } from "./router.js";
import type { FetchLike } from "./http.js";
import type { RouteProvider } from "./types.js";

export interface RoutingConfig {
  relay: { baseUrl: string; apiKey?: string };
  lifi: { baseUrl: string; apiKey?: string; integrator: string } | null;
  policy: RoutePolicy;
  appFee: { recipient: string; bps: number } | null;
}

function flag(env: Env, key: string, fallback: boolean): boolean {
  const value = readEnv(env, key);
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ChainConfigError(`${key} must be true or false, got "${value}"`);
}

function url(env: Env, key: string, fallback: string): string {
  const value = readEnv(env, key) ?? fallback;
  if (!/^https?:\/\//.test(value)) throw new ChainConfigError(`${key} must be an http(s) URL`);
  return value.replace(/\/+$/, "");
}

/** Parse "8453:*,1:0xa0b8…|0x0000…" into origin rules. */
export function parseOriginAllowlist(raw: string | undefined): "*" | OriginRule[] {
  if (raw === undefined || raw.trim() === "*") return "*";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [chain, tokens] = entry.split(":");
      const chainId = Number(chain);
      if (!Number.isSafeInteger(chainId) || chainId <= 0 || tokens === undefined || tokens.trim() === "") {
        throw new ChainConfigError(`ROUTE_ORIGIN_ALLOWLIST entry "${entry}" must look like <chainId>:<token|token|*>`);
      }
      return { chainId, tokens: tokens.trim() === "*" ? "*" : tokens.split("|").map((token) => token.trim()).filter(Boolean) };
    });
}

/** Routing config, or null when ROUTING_ENABLED is unset/false (no any-token option). */
export function loadRoutingConfig(env: Env): RoutingConfig | null {
  if (!flag(env, "ROUTING_ENABLED", false)) return null;
  const relayKey = readEnv(env, "RELAY_API_KEY");
  const lifiKey = readEnv(env, "LIFI_API_KEY");
  const feeBps = readInt(env, "ROUTE_APP_FEE_BPS", 0, 0, 500);
  const feeRecipient = readEnv(env, "ROUTE_APP_FEE_RECIPIENT");
  if (feeBps > 0 && (feeRecipient === undefined || !/^0x[0-9a-fA-F]{40}$/.test(feeRecipient))) {
    throw new ChainConfigError("ROUTE_APP_FEE_RECIPIENT must be a 0x address when ROUTE_APP_FEE_BPS > 0");
  }
  return {
    relay: { baseUrl: url(env, "RELAY_API_URL", RELAY_API_URL), ...(relayKey ? { apiKey: relayKey } : {}) },
    lifi: flag(env, "LIFI_ENABLED", true)
      ? {
          baseUrl: url(env, "LIFI_API_URL", LIFI_API_URL),
          ...(lifiKey ? { apiKey: lifiKey } : {}),
          integrator: readEnv(env, "LIFI_INTEGRATOR") ?? "settlekit",
        }
      : null,
    policy: {
      maxFeeBps: readInt(env, "ROUTE_MAX_FEE_BPS", DEFAULT_ROUTE_POLICY.maxFeeBps, 0, 2_000),
      maxSlippageBps: readInt(env, "ROUTE_MAX_SLIPPAGE_BPS", DEFAULT_ROUTE_POLICY.maxSlippageBps, 1, 1_000),
      quoteTtlSec: readInt(env, "ROUTE_QUOTE_TTL_SEC", DEFAULT_ROUTE_POLICY.quoteTtlSec, 30, 900),
      origins: parseOriginAllowlist(readEnv(env, "ROUTE_ORIGIN_ALLOWLIST")),
    },
    appFee: feeBps > 0 && feeRecipient !== undefined ? { recipient: feeRecipient, bps: feeBps } : null,
  };
}

/** Relay (+ LI.FI fallback) router for `config`. */
export function createRouterFromConfig(config: RoutingConfig, fetchImpl?: FetchLike): Router {
  const providers: RouteProvider[] = [
    createRelayProvider({ ...config.relay, referrer: "settlekit", ...(fetchImpl ? { fetch: fetchImpl } : {}) }),
  ];
  if (config.lifi !== null) providers.push(createLifiProvider({ ...config.lifi, ...(fetchImpl ? { fetch: fetchImpl } : {}) }));
  return createRouter(providers, config.policy);
}
