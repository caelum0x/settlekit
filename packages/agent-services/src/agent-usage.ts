import { generateId, type Money, type AgentService } from "@settlekit/common";
import { agentRequestPrice, agentUsageCost } from "./agent-pricing.js";

/**
 * A single billable invocation of an agent service by a buyer agent/customer.
 * Usage events feed metering, payouts and reputation aggregation.
 */
export interface AgentUsageEvent {
  id: string;
  serviceId: string;
  organizationId: string;
  buyerId: string;
  /** Number of requests this event accounts for (default 1). */
  units: number;
  /** Per-request price captured at the time of usage (USDC major units). */
  unitPrice: string;
  /** Total charged amount for this event. */
  amount: Money;
  createdAt: string;
}

/** Record a usage event for one (or `units`) invocation(s) of a service. */
export function recordAgentUsage(
  service: AgentService,
  buyerId: string,
  units = 1,
  now: Date = new Date(),
): AgentUsageEvent {
  if (!Number.isInteger(units) || units <= 0) {
    throw new RangeError(`units must be a positive integer, got ${units}`);
  }
  return {
    id: generateId("usageMeter"),
    serviceId: service.id,
    organizationId: service.organizationId,
    buyerId,
    units,
    unitPrice: agentRequestPrice(service.price).amount,
    amount: agentUsageCost(service.price, units),
    createdAt: now.toISOString(),
  };
}
