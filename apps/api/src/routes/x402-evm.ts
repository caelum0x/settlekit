/**
 * x402 on EVM chains: spec-compliant `exact` payments (EIP-3009
 * `transferWithAuthorization`, or Permit2 via the x402 proxy for tokens
 * without it). Base and Arbitrum settle through the remote facilitator
 * (PayAI); Ethereum, HyperEVM and Robinhood (and Tempo when explicitly
 * enabled) through SettleKit's self-hosted facilitator, whose standard
 * facilitator endpoints are also exposed here:
 *
 *   GET  /v1/x402/facilitator/supported   public
 *   GET  /v1/x402/facilitator/assets      public
 *   POST /v1/x402/facilitator/verify      Bearer X402_FACILITATOR_TOKEN
 *   POST /v1/x402/facilitator/settle      Bearer X402_FACILITATOR_TOKEN
 */
import { Hono } from "hono";
import type { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createFacilitatorHttpHandler } from "@settlekit/x402-facilitator";
import type { AgentPaymentNetwork, AgentPaymentsRuntime } from "../agent-payments/config.js";

/** EVM networks among the offered ones. */
export function evmNetworks(networks: readonly AgentPaymentNetwork[]): AgentPaymentNetwork[] {
  return networks.filter((entry) => entry.caip2.startsWith("eip155:"));
}

/** Register the `exact` EVM server scheme for every offered EVM network. */
export function registerEvmSchemes(server: x402ResourceServer, networks: readonly AgentPaymentNetwork[]): void {
  for (const entry of evmNetworks(networks)) server.register(entry.caip2, new ExactEvmScheme());
}

/** The self-hosted facilitator's HTTP surface, or 404s when it is not configured. */
export function localFacilitatorRoutes(runtime: AgentPaymentsRuntime | null): Hono {
  const app = new Hono();
  const local = runtime?.localFacilitator ?? null;
  if (!local) {
    app.all("*", (c) =>
      c.json({ error: { code: "not_found", message: "self-hosted x402 facilitator is not configured" } }, 404),
    );
    return app;
  }
  const handle = createFacilitatorHttpHandler(local, {
    ...(runtime?.facilitatorToken ? { authToken: runtime.facilitatorToken } : {}),
    basePath: "/v1/x402/facilitator",
  });
  app.all("*", (c) => handle(c.req.raw));
  return app;
}
