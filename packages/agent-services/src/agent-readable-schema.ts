import type { AgentService } from "@settlekit/common";
import type { AgentReadableMetadata } from "./types.js";

export function toAgentReadableMetadata(service: AgentService): AgentReadableMetadata {
  return {
    name: service.name,
    description: service.description,
    price: service.price,
    currency: service.currency,
    paymentProtocol: service.paymentProtocol,
    network: service.network,
    endpoint: service.endpoint,
    inputSchema: service.inputSchema,
    ...(service.outputSchema ? { outputSchema: service.outputSchema } : {}),
  };
}
