import { compareMoney, money, type AgentService } from "@settlekit/common";

/** Filter criteria for discovering agent service listings (plan §23). */
export interface AgentDiscoveryQuery {
  /** Free-text search over name + description (case-insensitive). */
  text?: string;
  /** Restrict to a specific settlement network. */
  network?: "arc" | "base";
  /** Only include published listings (default true). */
  publishedOnly?: boolean;
  /** Maximum per-request price (inclusive), USDC major units. */
  maxPrice?: string;
  /** Minimum per-request price (inclusive), USDC major units. */
  minPrice?: string;
  /** Restrict to a specific organization. */
  organizationId?: string;
}

/** Only the published listings (the default marketplace view). */
export function discoverPublishedAgentServices(services: readonly AgentService[]): AgentService[] {
  return services.filter((service) => service.published);
}

function matchesText(service: AgentService, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    service.name.toLowerCase().includes(needle) ||
    service.description.toLowerCase().includes(needle)
  );
}

/**
 * Filter/search agent service listings by text, network and price range.
 * Pure and immutable — returns a new array, never mutates the input.
 */
export function discoverAgentServices(
  services: readonly AgentService[],
  query: AgentDiscoveryQuery = {},
): AgentService[] {
  const publishedOnly = query.publishedOnly ?? true;
  const max = query.maxPrice !== undefined ? money(query.maxPrice) : undefined;
  const min = query.minPrice !== undefined ? money(query.minPrice) : undefined;

  return services.filter((service) => {
    if (publishedOnly && !service.published) return false;
    if (query.organizationId !== undefined && service.organizationId !== query.organizationId) {
      return false;
    }
    if (query.network !== undefined && service.network !== query.network) return false;
    if (query.text !== undefined && !matchesText(service, query.text)) return false;

    const price = money(service.price);
    if (max !== undefined && compareMoney(price, max) > 0) return false;
    if (min !== undefined && compareMoney(price, min) < 0) return false;
    return true;
  });
}
