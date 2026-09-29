/**
 * @settlekit/routing — pay with any token on any chain; the merchant receives
 * the session's stablecoin on the session's network.
 *
 * Relay (primary, hand-written REST client) and LI.FI (fallback) behind one
 * {@link RouteProvider} interface, EXACT_OUTPUT quotes to the merchant's
 * payTo with the buyer as refund address, a fee/slippage/origin/TTL policy,
 * the PaymentNetwork → destination map, and the session route record.
 *
 * A provider's "success" NEVER settles a payment: callers verify the
 * destination transfer with the network's fail-closed verifier.
 */
export * from "./types.js";
export * from "./http.js";
export * from "./destination.js";
export * from "./origins.js";
export * from "./policy.js";
export * from "./relay.js";
export * from "./lifi.js";
export * from "./router.js";
export * from "./session.js";
export * from "./env.js";
