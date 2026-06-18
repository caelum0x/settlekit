/**
 * Project a {@link Source} into an `AgentService` listing so autonomous agents
 * can discover and pay for it through the existing agent-services marketplace.
 */

import { type AgentService, toIso } from "@settlekit/common";
import type { Source } from "./types.js";

/** Options for {@link toAgentServiceListing}. */
export interface ListingOptions {
  /** Base URL the toll endpoints are served from (no trailing slash). */
  baseUrl: string;
  /** Merchant id to attribute the listing to. Defaults to the org id. */
  merchantId?: string;
}

/**
 * Build a discoverable, x402-priced agent-service listing for a source. The
 * endpoint is `<baseUrl>/articles/<id>`; agents discover it via
 * `discoverAgentServices` and pay it via the x402 payer.
 */
export function toAgentServiceListing(source: Source, options: ListingOptions): AgentService {
  return {
    id: source.id,
    organizationId: source.organizationId,
    merchantId: options.merchantId ?? source.organizationId,
    productId: source.id,
    name: source.title,
    description: source.summary,
    endpoint: `${options.baseUrl}/articles/${source.id}`,
    price: source.priceUsdc,
    currency: "USDC",
    paymentProtocol: "x402",
    network: source.network === "base" ? "base" : "arc",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
    },
    published: true,
    createdAt: toIso(new Date(source.createdAt)),
  };
}
