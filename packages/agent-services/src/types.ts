import type { AgentService } from "@settlekit/common";

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
