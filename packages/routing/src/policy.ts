/**
 * Routing policy: what a quote must satisfy before a buyer is shown it.
 *
 *   - origin chain/token on the allowlist (default: every offered origin);
 *   - the route delivers the destination token on the destination chain to
 *     the merchant's payTo, at least the amount owed (guaranteed minimum);
 *   - route cost <= maxFeeBps of the amount owed (unpriced quotes fail closed);
 *   - provider slippage tolerance <= maxSlippageBps;
 *   - a quote is shown for at most quoteTtlSec.
 *
 * Passing the policy never means paid: settlement is decided only by the
 * destination verifier on-chain.
 */

import { findOrigin, normalizeToken } from "./origins.js";
import { toDestinationUnits } from "./destination.js";
import type { RouteOrigin, RouteQuote, RouteQuoteRequest } from "./types.js";

export interface OriginRule {
  chainId: number;
  /** Allowed token addresses/mints, or "*" for every offered token on the chain. */
  tokens: "*" | readonly string[];
}

export interface RoutePolicy {
  maxFeeBps: number;
  maxSlippageBps: number;
  quoteTtlSec: number;
  /** "*" = every origin in ORIGIN_CHAINS. */
  origins: "*" | readonly OriginRule[];
}

export const DEFAULT_ROUTE_POLICY: RoutePolicy = {
  maxFeeBps: 300,
  maxSlippageBps: 100,
  quoteTtlSec: 120,
  origins: "*",
};

export type PolicyCheck = { ok: true } | { ok: false; reason: string };

const pass: PolicyCheck = { ok: true };
const reject = (reason: string): PolicyCheck => ({ ok: false, reason });

/** Whether the buyer may pay from `origin` under `policy`. */
export function checkOrigin(policy: RoutePolicy, origin: RouteOrigin): PolicyCheck {
  if (findOrigin(origin.chainId, origin.token) === undefined) {
    return reject(`paying with ${origin.token} on chain ${origin.chainId} is not offered`);
  }
  if (policy.origins === "*") return pass;
  const rule = policy.origins.find((entry) => entry.chainId === origin.chainId);
  if (rule === undefined) return reject(`chain ${origin.chainId} is not an allowed origin`);
  if (rule.tokens === "*") return pass;
  const token = normalizeToken(origin.token);
  return rule.tokens.some((allowed) => normalizeToken(allowed) === token)
    ? pass
    : reject(`token ${origin.token} is not allowed on chain ${origin.chainId}`);
}

function sameAddress(a: string, b: string): boolean {
  return normalizeToken(a) === normalizeToken(b);
}

/** Route cost in basis points of `destinationUsd`, rounded up; null when unpriced. */
export function feeBpsOf(originUsd: string | null, destinationUsd: string | null): number | null {
  if (originUsd === null || destinationUsd === null) return null;
  const spent = Number(originUsd);
  const received = Number(destinationUsd);
  if (!Number.isFinite(spent) || !Number.isFinite(received) || received <= 0) return null;
  return Math.max(0, Math.ceil(((spent - received) / received) * 10_000 - 1e-9));
}

/** Check a provider quote against the request it answers and the policy. */
export function evaluateQuote(policy: RoutePolicy, request: RouteQuoteRequest, quote: RouteQuote): PolicyCheck {
  const { destination } = request;
  if (quote.destination.chainId !== destination.chainId && quote.destination.chainId !== destination.lifi?.chainId) {
    return reject(`quote delivers on chain ${quote.destination.chainId}, not ${destination.chainId}`);
  }
  const expectedToken = quote.provider === "lifi" ? destination.lifi?.token ?? destination.token : destination.token;
  if (!sameAddress(quote.destination.token, expectedToken)) {
    return reject(`quote delivers ${quote.destination.token}, not ${expectedToken}`);
  }
  if (!sameAddress(quote.recipient, request.recipient)) return reject("quote pays a different recipient");
  if (quote.origin.chainId !== request.origin.chainId || !sameAddress(quote.origin.token, request.origin.token)) {
    return reject("quote spends a different origin token");
  }
  const owed = toDestinationUnits(request.amountBase, destination.decimals);
  let guaranteed: bigint;
  try {
    guaranteed = BigInt(quote.destination.minimumAmount);
  } catch {
    return reject("quote has no guaranteed destination amount");
  }
  if (guaranteed < owed) return reject(`quote guarantees ${guaranteed} base units, ${owed} are owed`);
  if (quote.feeBps === null) return reject("quote could not be priced in USD");
  if (quote.feeBps > policy.maxFeeBps) {
    return reject(`route costs ${(quote.feeBps / 100).toFixed(2)}%, above the ${(policy.maxFeeBps / 100).toFixed(2)}% limit`);
  }
  if (quote.slippageBps !== null && quote.slippageBps > policy.maxSlippageBps) {
    return reject(`slippage tolerance ${quote.slippageBps} bps is above the ${policy.maxSlippageBps} bps limit`);
  }
  if (request.depositAddress && quote.depositAddress === undefined) return reject("quote has no deposit address");
  return pass;
}

/** When a quote taken at `quotedAt` stops being shown. */
export function quoteExpiresAt(policy: RoutePolicy, quotedAt: Date): Date {
  return new Date(quotedAt.getTime() + policy.quoteTtlSec * 1000);
}
