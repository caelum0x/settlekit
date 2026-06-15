import type { AgentService } from "@settlekit/common";
import type { AgentUsageEvent } from "./agent-usage.js";
import type { AgentReputation } from "./agent-reputation.js";
import { emptyAgentReputation, addRating } from "./agent-reputation.js";

/**
 * Persistence boundary for the agent-services domain.
 *
 * Production code wires these to the real database package; tests construct the
 * in-memory implementation below to drive pure domain logic. These are real
 * interfaces of OUR storage contract, not fakes of external product behaviour.
 */
export interface AgentServiceStore {
  save(service: AgentService): Promise<AgentService>;
  findById(id: string): Promise<AgentService | null>;
  listByOrganization(organizationId: string): Promise<AgentService[]>;
  listAll(): Promise<AgentService[]>;
}

export interface AgentUsageStore {
  append(event: AgentUsageEvent): Promise<AgentUsageEvent>;
  listByService(serviceId: string): Promise<AgentUsageEvent[]>;
}

export interface AgentReputationStore {
  get(serviceId: string): Promise<AgentReputation>;
  /** Atomically fold a star rating into the service's aggregate. */
  recordRating(serviceId: string, stars: number): Promise<AgentReputation>;
}

/** Immutable clone so callers can never mutate stored state by reference. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryAgentServiceStore implements AgentServiceStore {
  private readonly services = new Map<string, AgentService>();

  async save(service: AgentService): Promise<AgentService> {
    this.services.set(service.id, clone(service));
    return clone(service);
  }

  async findById(id: string): Promise<AgentService | null> {
    const found = this.services.get(id);
    return found ? clone(found) : null;
  }

  async listByOrganization(organizationId: string): Promise<AgentService[]> {
    return [...this.services.values()]
      .filter((s) => s.organizationId === organizationId)
      .map(clone);
  }

  async listAll(): Promise<AgentService[]> {
    return [...this.services.values()].map(clone);
  }
}

export class InMemoryAgentUsageStore implements AgentUsageStore {
  private readonly events: AgentUsageEvent[] = [];

  async append(event: AgentUsageEvent): Promise<AgentUsageEvent> {
    this.events.push(clone(event));
    return clone(event);
  }

  async listByService(serviceId: string): Promise<AgentUsageEvent[]> {
    return this.events.filter((e) => e.serviceId === serviceId).map(clone);
  }
}

export class InMemoryAgentReputationStore implements AgentReputationStore {
  private readonly reputations = new Map<string, AgentReputation>();

  async get(serviceId: string): Promise<AgentReputation> {
    return clone(this.reputations.get(serviceId) ?? emptyAgentReputation(serviceId));
  }

  async recordRating(serviceId: string, stars: number): Promise<AgentReputation> {
    const current = this.reputations.get(serviceId) ?? emptyAgentReputation(serviceId);
    const next = addRating(current, stars);
    this.reputations.set(serviceId, next);
    return clone(next);
  }
}
