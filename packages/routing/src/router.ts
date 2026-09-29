/**
 * Provider composition: Relay first, LI.FI as fallback. A quote is returned
 * only when it passes the {@link RoutePolicy}; otherwise the next provider is
 * tried, and the combined reasons surface as `no_route`.
 */

import { isRouteError, RouteError } from "./http.js";
import { checkOrigin, evaluateQuote, type RoutePolicy } from "./policy.js";
import type { RouteDestination, RouteProvider, RouteProviderName, RouteQuote, RouteQuoteRequest, RouteStatus } from "./types.js";

export interface Router {
  readonly providers: readonly RouteProvider[];
  readonly policy: RoutePolicy;
  /** Best policy-compliant quote (first provider that yields one). */
  quote(request: RouteQuoteRequest): Promise<RouteQuote>;
  /** Status from the provider that issued the route. */
  status(input: {
    provider: RouteProviderName;
    requestId: string;
    originChainId: number;
    destination: RouteDestination;
    originTxHash?: string;
  }): Promise<RouteStatus>;
}

export function createRouter(providers: readonly RouteProvider[], policy: RoutePolicy): Router {
  async function quote(request: RouteQuoteRequest): Promise<RouteQuote> {
    const origin = checkOrigin(policy, request.origin);
    if (!origin.ok) throw new RouteError("policy_violation", origin.reason);
    const candidates = providers.filter((provider) => provider.supports(request.destination, request.origin, request.depositAddress));
    if (candidates.length === 0) throw new RouteError("unsupported", `no route provider serves ${request.destination.network} in this mode`);
    const reasons: string[] = [];
    let lastError: RouteError | undefined;
    for (const provider of candidates) {
      try {
        const quoted = await provider.quote({ ...request, slippageBps: request.slippageBps ?? policy.maxSlippageBps });
        const verdict = evaluateQuote(policy, request, quoted);
        if (verdict.ok) return quoted;
        reasons.push(`${provider.name}: ${verdict.reason}`);
        lastError = new RouteError("policy_violation", verdict.reason);
      } catch (error) {
        if (!isRouteError(error)) throw error;
        reasons.push(`${provider.name}: ${error.message}`);
        lastError = error;
      }
    }
    if (candidates.length === 1 && lastError !== undefined) throw lastError;
    throw new RouteError("no_route", reasons.join("; "));
  }

  async function status(input: Parameters<Router["status"]>[0]): Promise<RouteStatus> {
    const provider = providers.find((entry) => entry.name === input.provider);
    if (provider === undefined) throw new RouteError("unsupported", `route provider ${input.provider} is not enabled`);
    const destinationChainId = input.provider === "lifi" ? input.destination.lifi?.chainId ?? input.destination.chainId : input.destination.chainId;
    return provider.status({
      requestId: input.requestId,
      originChainId: input.originChainId,
      destinationChainId,
      ...(input.originTxHash !== undefined ? { originTxHash: input.originTxHash } : {}),
    });
  }

  return { providers, policy, quote, status };
}
