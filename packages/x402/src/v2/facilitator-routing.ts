/**
 * Facilitator routing for spec-compliant x402 v2 (x402-foundation `@x402/*`).
 *
 * An `x402ResourceServer` accepts several facilitator clients and maps each
 * (network, scheme) to the FIRST client whose `/supported` lists it. SettleKit
 * pins that mapping explicitly instead of relying on order: each client is
 * scoped to the networks it is meant to serve (PayAI for Solana/Base/Arbitrum,
 * the self-hosted facilitator for Ethereum/HyperEVM/Robinhood/Tempo), so a
 * remote facilitator that later adds a network cannot silently take over a
 * self-facilitated one, and a request routed to the wrong client fails closed.
 */
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";

/** PayAI's public facilitator (no API key): Solana, Base, Arbitrum (+ testnets). */
export const PAYAI_FACILITATOR_URL = "https://facilitator.payai.network";

/** The x402.org facilitator (testnets only). */
export const X402_ORG_FACILITATOR_URL = "https://x402.org/facilitator";

export interface FacilitatorRoute {
  /** Label used in errors and status output (e.g. "payai", "local"). */
  name: string;
  client: FacilitatorClient;
  /** CAIP-2 networks this client is allowed to serve. */
  networks: readonly string[];
}

/** Error raised when a payment reaches a client not routed for its network. */
export class FacilitatorRoutingError extends Error {
  override readonly name = "FacilitatorRoutingError";
}

/** A facilitator client restricted to `route.networks`. */
export class NetworkScopedFacilitatorClient implements FacilitatorClient {
  readonly name: string;
  private readonly networks: ReadonlySet<string>;

  constructor(private readonly route: FacilitatorRoute) {
    this.name = route.name;
    this.networks = new Set(route.networks);
  }

  serves(network: string): boolean {
    return this.networks.has(network);
  }

  private assertServes(network: string): void {
    if (!this.serves(network)) {
      throw new FacilitatorRoutingError(`facilitator "${this.name}" is not routed for ${network}`);
    }
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    this.assertServes(requirements.network);
    return this.route.client.verify(payload, requirements);
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    this.assertServes(requirements.network);
    return this.route.client.settle(payload, requirements);
  }

  async getSupported(): Promise<SupportedResponse> {
    const supported = await this.route.client.getSupported();
    return { ...supported, kinds: supported.kinds.filter((kind) => this.serves(kind.network)) };
  }
}

/**
 * Scope every route to its networks. Throws when two routes claim the same
 * network so the mapping stays unambiguous. Routes with no networks are dropped.
 */
export function routeFacilitators(routes: readonly FacilitatorRoute[]): NetworkScopedFacilitatorClient[] {
  const owner = new Map<string, string>();
  for (const route of routes) {
    for (const network of route.networks) {
      const existing = owner.get(network);
      if (existing !== undefined && existing !== route.name) {
        throw new FacilitatorRoutingError(`network ${network} is routed to both "${existing}" and "${route.name}"`);
      }
      owner.set(network, route.name);
    }
  }
  return routes.filter((route) => route.networks.length > 0).map((route) => new NetworkScopedFacilitatorClient(route));
}
