/**
 * Agent-economy persistence: an off-chain registry mirroring the ERC-8004 agent
 * identity/reputation and ERC-8183 job lifecycle. The chain is the source of
 * truth for settled state; these tables give the API a queryable, org-scoped
 * record (register an agent, track a job through its lifecycle) without an RPC
 * round-trip. Document-projection pattern: the canonical record lives in
 * `metadata.__doc`; typed columns are projected for indexed lookups.
 */
import { pgTable, text, index } from "drizzle-orm/pg-core";
import { idColumn, timestamps, metadataColumn, amountColumn } from "./_shared.js";

/** A registered AI agent (off-chain mirror of an ERC-8004 identity). */
export const agentRegistry = pgTable(
  "agent_registry",
  {
    id: idColumn(),
    organizationId: text("organization_id").notNull(),
    /** Owner wallet address. */
    owner: text("owner").notNull(),
    /** Metadata URI (e.g. an IPFS agent card). */
    metadataUri: text("metadata_uri").notNull(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    orgIdx: index("agent_registry_org_idx").on(table.organizationId),
    ownerIdx: index("agent_registry_owner_idx").on(table.owner),
  }),
);

/** An agent job (off-chain mirror of an ERC-8183 job lifecycle). */
export const agentJobs = pgTable(
  "agent_jobs",
  {
    id: idColumn(),
    organizationId: text("organization_id").notNull(),
    requester: text("requester").notNull(),
    worker: text("worker").notNull(),
    amount: amountColumn("amount"),
    /** Lifecycle status: created/funded/submitted/evaluated/settled/refunded/cancelled. */
    status: text("status").notNull(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    orgIdx: index("agent_jobs_org_idx").on(table.organizationId),
    statusIdx: index("agent_jobs_status_idx").on(table.status),
  }),
);
