import type { AgentService } from "@settlekit/common";
import type { AgentReadableMetadata } from "./types.js";
import { toAgentReadableMetadata } from "./agent-readable-schema.js";

/**
 * Generate the machine-readable JSON metadata for an agent service, exactly in
 * the shape defined by plan §11:
 *
 *   { name, description, price, currency:"USDC", paymentProtocol:"x402",
 *     network, endpoint, inputSchema, outputSchema? }
 *
 * This is the canonical entry point named in the package responsibilities.
 */
export function generateAgentMetadata(service: AgentService): AgentReadableMetadata {
  return toAgentReadableMetadata(service);
}

/** Serialize the agent metadata document to a JSON string. */
export function serializeAgentMetadata(service: AgentService): string {
  return JSON.stringify(generateAgentMetadata(service));
}

export { toAgentReadableMetadata as buildAgentServiceMetadata };
