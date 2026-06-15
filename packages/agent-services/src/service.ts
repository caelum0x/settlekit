import {
  type Result,
  ok,
  err,
  isErr,
  notFound,
  type SettleKitError,
  type AgentService,
} from "@settlekit/common";
import {
  createAgentService,
  publishAgentService,
  unpublishAgentService,
  type CreateAgentServiceInput,
} from "./agent-service.js";
import { generateAgentMetadata } from "./agent-service-metadata.js";
import type { AgentReadableMetadata } from "./types.js";
import { validateInputAgainstSchema } from "./json-schema-validate.js";
import { recordAgentUsage, type AgentUsageEvent } from "./agent-usage.js";
import { discoverAgentServices, type AgentDiscoveryQuery } from "./agent-discovery.js";
import type { AgentReputation } from "./agent-reputation.js";
import type {
  AgentServiceStore,
  AgentUsageStore,
  AgentReputationStore,
} from "./store.js";

export interface AgentServiceServiceDeps {
  services: AgentServiceStore;
  usage: AgentUsageStore;
  reputation: AgentReputationStore;
  /** Clock injection for deterministic timestamps in tests. */
  now?: () => Date;
}

/**
 * Application service orchestrating the agent-services domain: create/publish
 * listings, serve agent-readable metadata, validate buyer input against the
 * declared schema, record usage and aggregate reputation.
 */
export class AgentServiceService {
  private readonly services: AgentServiceStore;
  private readonly usage: AgentUsageStore;
  private readonly reputation: AgentReputationStore;
  private readonly now: () => Date;

  constructor(deps: AgentServiceServiceDeps) {
    this.services = deps.services;
    this.usage = deps.usage;
    this.reputation = deps.reputation;
    this.now = deps.now ?? (() => new Date());
  }

  /** Create and persist a new (unpublished) agent service listing. */
  async create(
    input: CreateAgentServiceInput,
  ): Promise<Result<AgentService, SettleKitError>> {
    const created = createAgentService(input, this.now());
    if (isErr(created)) return created;
    const saved = await this.services.save(created.value);
    return ok(saved);
  }

  async get(id: string): Promise<Result<AgentService, SettleKitError>> {
    const found = await this.services.findById(id);
    if (found === null) {
      return err(notFound("Agent service not found", { id }));
    }
    return ok(found);
  }

  async publish(id: string): Promise<Result<AgentService, SettleKitError>> {
    const found = await this.get(id);
    if (isErr(found)) return found;
    const saved = await this.services.save(publishAgentService(found.value));
    return ok(saved);
  }

  async unpublish(id: string): Promise<Result<AgentService, SettleKitError>> {
    const found = await this.get(id);
    if (isErr(found)) return found;
    const saved = await this.services.save(unpublishAgentService(found.value));
    return ok(saved);
  }

  /** Return the plan §11 machine-readable metadata for a service. */
  async metadata(id: string): Promise<Result<AgentReadableMetadata, SettleKitError>> {
    const found = await this.get(id);
    if (isErr(found)) return found;
    return ok(generateAgentMetadata(found.value));
  }

  /** Discover/search listings via the discovery query. */
  async discover(query: AgentDiscoveryQuery = {}): Promise<AgentService[]> {
    const all = query.organizationId
      ? await this.services.listByOrganization(query.organizationId)
      : await this.services.listAll();
    return discoverAgentServices(all, query);
  }

  /**
   * Validate a buyer's input against the service schema and, when valid, record
   * a usage event. Returns the usage event or a `validation_error`/`not_found`.
   */
  async invoke(
    id: string,
    input: unknown,
    buyerId: string,
    units = 1,
  ): Promise<Result<AgentUsageEvent, SettleKitError>> {
    const found = await this.get(id);
    if (isErr(found)) return found;

    const validated = validateInputAgainstSchema(input, found.value.inputSchema);
    if (isErr(validated)) return validated;

    const event = recordAgentUsage(found.value, buyerId, units, this.now());
    const persisted = await this.usage.append(event);
    return ok(persisted);
  }

  /** Record a 1..5 star rating for a service and return the new aggregate. */
  async rate(id: string, stars: number): Promise<Result<AgentReputation, SettleKitError>> {
    const found = await this.get(id);
    if (isErr(found)) return found;
    const updated = await this.reputation.recordRating(id, stars);
    return ok(updated);
  }

  async getReputation(id: string): Promise<AgentReputation> {
    return this.reputation.get(id);
  }
}
