import type { AgentService } from "@settlekit/common";
import type { AgentReadableMetadata } from "./types.js";

/**
 * Project an `AgentService` into its agent-readable metadata document.
 *
 * The key ordering and field set are fixed to plan §11 so the emitted JSON is
 * stable for downstream agents that fingerprint or cache the document.
 */
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
