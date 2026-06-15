/**
 * Postgres-backed {@link AgentUsageStore} (@settlekit/agent-services). The
 * canonical AgentUsageEvent lives in `metadata.__doc`; typed columns are
 * projected for querying. `agent_buyer_id` is null (the buyer id lives in the
 * document); listByService filters on the projected `agent_service_id`.
 */
import { eq, type Database, agentUsageEvents } from "@settlekit/database";
import type { AgentUsageStore, AgentUsageEvent } from "@settlekit/agent-services";
import { packDoc, unpackDocs } from "../codec.js";

export class PgAgentUsageStore implements AgentUsageStore {
  constructor(private readonly db: Database) {}

  async append(event: AgentUsageEvent): Promise<AgentUsageEvent> {
    const projection = {
      agentServiceId: event.serviceId,
      agentBuyerId: null,
      currency: event.amount.currency,
      amount: event.amount.amount,
      occurredAt: new Date(event.createdAt),
      metadata: packDoc(event),
    };
    await this.db
      .insert(agentUsageEvents)
      .values({ id: event.id, ...projection })
      .onConflictDoUpdate({ target: agentUsageEvents.id, set: projection });
    return event;
  }

  async listByService(serviceId: string): Promise<AgentUsageEvent[]> {
    const rows = await this.db
      .select({ metadata: agentUsageEvents.metadata })
      .from(agentUsageEvents)
      .where(eq(agentUsageEvents.agentServiceId, serviceId));
    return unpackDocs<AgentUsageEvent>(rows);
  }
}
