/**
 * The session-side record of a route (`CheckoutSession.route`): created from
 * a quote, advanced by provider status. Pure and immutable — the caller
 * persists the returned value. Nothing here marks a session paid.
 */

import type { CheckoutRoute, PaymentNetwork, RouteState } from "@settlekit/common";
import type { RouteQuote, RouteQuoteRequest, RouteStatus } from "./types.js";

/** States after which a provider will not move funds any more. */
export const TERMINAL_ROUTE_STATES: ReadonlySet<RouteState> = new Set(["success", "refund", "failure"]);

export function isRouteTerminal(route: CheckoutRoute): boolean {
  return TERMINAL_ROUTE_STATES.has(route.state);
}

/** A fresh route record for an accepted quote. */
export function routeFromQuote(
  quote: RouteQuote,
  request: RouteQuoteRequest,
  network: PaymentNetwork,
  quotedAt: Date,
  expiresAt: Date,
): CheckoutRoute {
  return {
    provider: quote.provider,
    requestId: quote.requestId,
    network,
    originChainId: request.origin.chainId,
    originToken: request.origin.token,
    originAmount: quote.origin.amount,
    originAddress: request.user,
    ...(quote.depositAddress !== undefined ? { depositAddress: quote.depositAddress } : {}),
    quotedAt: quotedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    state: "quoted",
    updatedAt: quotedAt.toISOString(),
  };
}

/** Apply a provider status to `route` (never regresses a terminal state). */
export function applyRouteStatus(route: CheckoutRoute, status: RouteStatus, now: Date): CheckoutRoute {
  if (isRouteTerminal(route)) return route;
  if (status.state === "unknown") return route;
  const destination = status.destinationTxHashes[0];
  const refund = status.refundTxHashes[0];
  const origin = route.originTxHash ?? status.originTxHashes[0];
  return {
    ...route,
    state: status.state,
    ...(origin !== undefined ? { originTxHash: origin } : {}),
    ...(status.state === "success" && destination !== undefined ? { destinationTxHash: destination } : {}),
    ...(status.state === "refund" && refund !== undefined ? { refundTxHash: refund } : {}),
    ...(status.detail !== null ? { detail: status.detail } : {}),
    updatedAt: now.toISOString(),
  };
}
