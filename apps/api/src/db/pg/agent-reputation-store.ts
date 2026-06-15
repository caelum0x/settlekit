/**
 * Postgres-backed {@link AgentReputationStore} (@settlekit/agent-services). The
 * canonical AgentReputation lives in `metadata.__doc`; typed columns are
 * projected for querying. recordRating is a read-modify-write that folds the new
 * star rating into the stored aggregate via the pure domain `addRating`.
 */
import { eq, type Database, agentReputations } from "@settlekit/database";
import type { AgentReputationStore, AgentReputation } from "@settlekit/agent-services";
import { emptyAgentReputation, addRating } from "@settlekit/agent-services";
import { packDoc, unpackDoc } from "../codec.js";

export class PgAgentReputationStore implements AgentReputationStore {
  constructor(private readonly db: Database) {}

  async get(serviceId: string): Promise<AgentReputation> {
    const rows = await this.db
      .select({ metadata: agentReputations.metadata })
      .from(agentReputations)
      .where(eq(agentReputations.id, serviceId))
      .limit(1);
    return unpackDoc<AgentReputation>(rows[0]) ?? emptyAgentReputation(serviceId);
  }

  async recordRating(serviceId: string, stars: number): Promise<AgentReputation> {
    const current = await this.get(serviceId);
    const next = addRating(current, stars);
    const projection = {
      serviceId: next.serviceId,
      ratingCount: next.ratingCount,
      ratingSum: next.ratingTotal,
      ratingAverage: String(next.ratingAverage),
      metadata: packDoc(next),
    };
    await this.db
      .insert(agentReputations)
      .values({ id: serviceId, ...projection })
      .onConflictDoUpdate({ target: agentReputations.id, set: projection });
    return next;
  }
}
