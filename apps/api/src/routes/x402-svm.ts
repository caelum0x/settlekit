/**
 * x402 on Solana (SOLANA-PLAN section D): spec-compliant `exact` SVM payments
 * (a partially-signed SPL USDC transfer the facilitator co-signs as fee payer
 * and submits). Facilitated remotely by PayAI; mounted into the shared agent
 * router in ./x402-evm.ts so one 402 challenge offers every network.
 */
import type { x402ResourceServer } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { AgentPaymentNetwork } from "../agent-payments/config.js";

/** Solana networks among the offered ones. */
export function svmNetworks(networks: readonly AgentPaymentNetwork[]): AgentPaymentNetwork[] {
  return networks.filter((entry) => entry.network === "solana");
}

/** Register the `exact` SVM server scheme for every offered Solana network. */
export function registerSvmSchemes(server: x402ResourceServer, networks: readonly AgentPaymentNetwork[]): void {
  for (const entry of svmNetworks(networks)) server.register(entry.caip2, new ExactSvmScheme());
}
