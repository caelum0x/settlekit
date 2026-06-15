/**
 * Postgres-backed {@link AgentServiceStore}.
 * Canonical AgentService in `metadata.__doc`; columns projected for querying.
 * The `agent_services` table has no organization column, so
 * `listByOrganization` filters against the canonical document.
 */
import { eq, type Database, agentServices } from "@settlekit/database";
import type { AgentService } from "@settlekit/common";
import type { AgentServiceStore } from "@settlekit/agent-services";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgAgentServiceStore implements AgentServiceStore {
  constructor(private readonly db: Database) {}

  async save(service: AgentService): Promise<AgentService> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      name: service.name,
      slug: service.id,
      description: service.description ?? null,
      endpointUrl: service.endpoint,
      currency: service.currency,
      pricePerCall: service.price,
      status: service.published ? "active" : "draft",
      metadata: packDoc(service),
    };
    await this.db
      .insert(agentServices)
      .values({ id: service.id, ...projection })
      .onConflictDoUpdate({ target: agentServices.id, set: projection });
    return service;
  }

  async findById(id: string): Promise<AgentService | null> {
    const rows = await this.db
      .select({ metadata: agentServices.metadata })
      .from(agentServices)
      .where(eq(agentServices.id, id))
      .limit(1);
    return unpackDoc<AgentService>(rows[0]);
  }

  async listByOrganization(organizationId: string): Promise<AgentService[]> {
    const rows = await this.db
      .select({ metadata: agentServices.metadata })
      .from(agentServices);
    const all = unpackDocs<AgentService>(rows);
    return all.filter((s) => s.organizationId === organizationId);
  }

  async listAll(): Promise<AgentService[]> {
    const rows = await this.db
      .select({ metadata: agentServices.metadata })
      .from(agentServices);
    return unpackDocs<AgentService>(rows);
  }
}
