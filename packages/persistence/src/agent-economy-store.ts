/**
 * Off-chain agent-economy registry stores: a queryable, org-scoped mirror of
 * ERC-8004 agent identities/reputation and ERC-8183 job lifecycles. The chain
 * remains the source of truth for settled value; these give the API fast
 * register/list/track without an RPC round-trip.
 *
 * In-memory + Postgres implementations of the same interfaces. Pg uses the
 * document-projection pattern: the canonical record lives in `metadata.__doc`,
 * with `organization_id` / `owner` / `status` projected for indexed lookups.
 */

import { and, eq, type Database, agentRegistry, agentJobs } from "@settlekit/database";
import { uuid } from "@settlekit/common";
import { packDoc, unpackDoc } from "./codec.js";

/** Job lifecycle status (mirrors @settlekit/erc8183 JobStatus). */
export type JobStatus =
  | "created"
  | "funded"
  | "submitted"
  | "evaluated"
  | "settled"
  | "refunded"
  | "cancelled";

/** A registered agent record. */
export interface AgentRecord {
  id: string;
  organizationId: string;
  owner: string;
  metadataUri: string;
  displayName?: string;
  /** Average reputation score (0–100) across recorded feedback. */
  reputationScore?: number;
  /** Number of feedback entries recorded. */
  reputationCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** An agent job record. */
export interface JobRecord {
  id: string;
  organizationId: string;
  requester: string;
  worker: string;
  amountUsdc: string;
  status: JobStatus;
  deliverableUri?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  organizationId: string;
  owner: string;
  metadataUri: string;
  displayName?: string;
}

export interface CreateJobInput {
  organizationId: string;
  requester: string;
  worker: string;
  amountUsdc: string;
}

/** Persistence boundary for the agent identity registry. */
export interface AgentRegistryStore {
  createAgent(input: CreateAgentInput): Promise<AgentRecord>;
  getAgent(organizationId: string, id: string): Promise<AgentRecord | undefined>;
  listAgents(organizationId: string): Promise<readonly AgentRecord[]>;
  /** Append a reputation score (0–100) and return the updated record. */
  recordFeedback(
    organizationId: string,
    id: string,
    score: number,
  ): Promise<AgentRecord | undefined>;
}

/** Persistence boundary for the agent job registry. */
export interface AgentJobStore {
  createJob(input: CreateJobInput): Promise<JobRecord>;
  getJob(organizationId: string, id: string): Promise<JobRecord | undefined>;
  listJobs(organizationId: string): Promise<readonly JobRecord[]>;
  /** Update a job's status (and optional deliverable) and return it. */
  updateJob(
    organizationId: string,
    id: string,
    patch: { status?: JobStatus; deliverableUri?: string },
  ): Promise<JobRecord | undefined>;
}

function nextReputation(record: AgentRecord, score: number): Pick<AgentRecord, "reputationScore" | "reputationCount"> {
  const count = (record.reputationCount ?? 0) + 1;
  const prevTotal = (record.reputationScore ?? 0) * (record.reputationCount ?? 0);
  return { reputationScore: Math.round((prevTotal + score) / count), reputationCount: count };
}

/* -------------------------------------------------------------------------- */
/* In-memory                                                                  */
/* -------------------------------------------------------------------------- */

export class InMemoryAgentRegistryStore implements AgentRegistryStore {
  private readonly byId = new Map<string, AgentRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async createAgent(input: CreateAgentInput): Promise<AgentRecord> {
    const ts = this.now().toISOString();
    const record: AgentRecord = {
      id: `agt_${uuid()}`,
      organizationId: input.organizationId,
      owner: input.owner,
      metadataUri: input.metadataUri,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      reputationScore: 0,
      reputationCount: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    this.byId.set(record.id, record);
    return { ...record };
  }

  async getAgent(organizationId: string, id: string): Promise<AgentRecord | undefined> {
    const found = this.byId.get(id);
    return found && found.organizationId === organizationId ? { ...found } : undefined;
  }

  async listAgents(organizationId: string): Promise<readonly AgentRecord[]> {
    return [...this.byId.values()]
      .filter((a) => a.organizationId === organizationId)
      .map((a) => ({ ...a }));
  }

  async recordFeedback(organizationId: string, id: string, score: number): Promise<AgentRecord | undefined> {
    const found = this.byId.get(id);
    if (!found || found.organizationId !== organizationId) return undefined;
    const updated: AgentRecord = { ...found, ...nextReputation(found, score), updatedAt: this.now().toISOString() };
    this.byId.set(id, updated);
    return { ...updated };
  }
}

export class InMemoryAgentJobStore implements AgentJobStore {
  private readonly byId = new Map<string, JobRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async createJob(input: CreateJobInput): Promise<JobRecord> {
    const ts = this.now().toISOString();
    const record: JobRecord = {
      id: `job_${uuid()}`,
      organizationId: input.organizationId,
      requester: input.requester,
      worker: input.worker,
      amountUsdc: input.amountUsdc,
      status: "created",
      createdAt: ts,
      updatedAt: ts,
    };
    this.byId.set(record.id, record);
    return { ...record };
  }

  async getJob(organizationId: string, id: string): Promise<JobRecord | undefined> {
    const found = this.byId.get(id);
    return found && found.organizationId === organizationId ? { ...found } : undefined;
  }

  async listJobs(organizationId: string): Promise<readonly JobRecord[]> {
    return [...this.byId.values()]
      .filter((j) => j.organizationId === organizationId)
      .map((j) => ({ ...j }));
  }

  async updateJob(
    organizationId: string,
    id: string,
    patch: { status?: JobStatus; deliverableUri?: string },
  ): Promise<JobRecord | undefined> {
    const found = this.byId.get(id);
    if (!found || found.organizationId !== organizationId) return undefined;
    const updated: JobRecord = {
      ...found,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.deliverableUri !== undefined ? { deliverableUri: patch.deliverableUri } : {}),
      updatedAt: this.now().toISOString(),
    };
    this.byId.set(id, updated);
    return { ...updated };
  }
}

/* -------------------------------------------------------------------------- */
/* Postgres                                                                   */
/* -------------------------------------------------------------------------- */

export class PgAgentRegistryStore implements AgentRegistryStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createAgent(input: CreateAgentInput): Promise<AgentRecord> {
    const ts = this.now().toISOString();
    const record: AgentRecord = {
      id: `agt_${uuid()}`,
      organizationId: input.organizationId,
      owner: input.owner,
      metadataUri: input.metadataUri,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      reputationScore: 0,
      reputationCount: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.db.insert(agentRegistry).values({
      id: record.id,
      organizationId: record.organizationId,
      owner: record.owner,
      metadataUri: record.metadataUri,
      metadata: packDoc(record),
    });
    return record;
  }

  async getAgent(organizationId: string, id: string): Promise<AgentRecord | undefined> {
    const rows = await this.db
      .select({ metadata: agentRegistry.metadata })
      .from(agentRegistry)
      .where(and(eq(agentRegistry.id, id), eq(agentRegistry.organizationId, organizationId)))
      .limit(1);
    return unpackDoc<AgentRecord>(rows[0]) ?? undefined;
  }

  async listAgents(organizationId: string): Promise<readonly AgentRecord[]> {
    const rows = await this.db
      .select({ metadata: agentRegistry.metadata })
      .from(agentRegistry)
      .where(eq(agentRegistry.organizationId, organizationId));
    return rows.map((r) => unpackDoc<AgentRecord>(r)).filter((a): a is AgentRecord => a !== undefined);
  }

  async recordFeedback(organizationId: string, id: string, score: number): Promise<AgentRecord | undefined> {
    const existing = await this.getAgent(organizationId, id);
    if (!existing) return undefined;
    const updated: AgentRecord = { ...existing, ...nextReputation(existing, score), updatedAt: this.now().toISOString() };
    await this.db
      .update(agentRegistry)
      .set({ metadata: packDoc(updated) })
      .where(and(eq(agentRegistry.id, id), eq(agentRegistry.organizationId, organizationId)));
    return updated;
  }
}

export class PgAgentJobStore implements AgentJobStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createJob(input: CreateJobInput): Promise<JobRecord> {
    const ts = this.now().toISOString();
    const record: JobRecord = {
      id: `job_${uuid()}`,
      organizationId: input.organizationId,
      requester: input.requester,
      worker: input.worker,
      amountUsdc: input.amountUsdc,
      status: "created",
      createdAt: ts,
      updatedAt: ts,
    };
    await this.db.insert(agentJobs).values({
      id: record.id,
      organizationId: record.organizationId,
      requester: record.requester,
      worker: record.worker,
      amount: record.amountUsdc,
      status: record.status,
      metadata: packDoc(record),
    });
    return record;
  }

  async getJob(organizationId: string, id: string): Promise<JobRecord | undefined> {
    const rows = await this.db
      .select({ metadata: agentJobs.metadata })
      .from(agentJobs)
      .where(and(eq(agentJobs.id, id), eq(agentJobs.organizationId, organizationId)))
      .limit(1);
    return unpackDoc<JobRecord>(rows[0]) ?? undefined;
  }

  async listJobs(organizationId: string): Promise<readonly JobRecord[]> {
    const rows = await this.db
      .select({ metadata: agentJobs.metadata })
      .from(agentJobs)
      .where(eq(agentJobs.organizationId, organizationId));
    return rows.map((r) => unpackDoc<JobRecord>(r)).filter((j): j is JobRecord => j !== undefined);
  }

  async updateJob(
    organizationId: string,
    id: string,
    patch: { status?: JobStatus; deliverableUri?: string },
  ): Promise<JobRecord | undefined> {
    const existing = await this.getJob(organizationId, id);
    if (!existing) return undefined;
    const updated: JobRecord = {
      ...existing,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.deliverableUri !== undefined ? { deliverableUri: patch.deliverableUri } : {}),
      updatedAt: this.now().toISOString(),
    };
    await this.db
      .update(agentJobs)
      .set({ status: updated.status, metadata: packDoc(updated) })
      .where(and(eq(agentJobs.id, id), eq(agentJobs.organizationId, organizationId)));
    return updated;
  }
}
