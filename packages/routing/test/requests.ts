/** Shared request builders for the routing tests. */
import { routeDestinationFor, type RouteDestination, type RouteQuoteRequest } from "../src/index.js";

export const USER = "0x5b1e2c3d4e5f60718293a4b5c6d7e8f901234567";
export const RECIPIENT = "0x1f2e3d4c5b6a79880706a5b4c3d2e1f0a9b8c7d6";
export const SOL_RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const ARB_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

export function destination(network: Parameters<typeof routeDestinationFor>[0]): RouteDestination {
  const result = routeDestinationFor(network, { env: "mainnet" });
  if (!result.ok) throw new Error(result.reason);
  return result.destination;
}

export function baseRequest(overrides: Partial<RouteQuoteRequest> = {}): RouteQuoteRequest {
  return {
    destination: destination("base"),
    amountBase: 5_000_000n,
    recipient: RECIPIENT,
    origin: { chainId: 42161, token: ARB_USDC },
    user: USER,
    refundTo: USER,
    depositAddress: false,
    ...overrides,
  };
}

