import type { AgentService } from "@settlekit/common";

/**
 * The machine-readable metadata document advertised for an agent service.
 * Shape mirrors plan §11 exactly: an agent (the buyer) reads this JSON to learn
 * how to call and pay for the service.
 */
export interface AgentReadableMetadata {
  name: string;
  description: string;
  price: string;
  currency: "USDC";
  paymentProtocol: "x402";
  network: "arc" | "base";
  endpoint: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export type { AgentService };
