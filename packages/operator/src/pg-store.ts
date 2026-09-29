/**
 * Postgres-backed OperatorStore using the document-projection pattern.
 *
 * Tables are self-created (`CREATE TABLE IF NOT EXISTS`) — they are owned by
 * this package, not by the drizzle migrations in @settlekit/database. Each row
 * stores the full canonical entity under `metadata.__doc` (packDoc/unpackDoc)
 * with bigints tagged by the JSON codec, plus typed projection columns for
 * filtering and ordering. `(org_id, seq)` is unique, so a concurrent append
 * that would fork the decision chain fails at the database.
 */
import { packDoc, unpackDoc } from "@settlekit/database";
import type { DecisionRecord } from "./decision-log.js";
import type { Escalation, EscalationStatus } from "./escalation.js";
import { fromJsonValue, toJsonValue } from "./json.js";
import { assertLinks, type ListDecisionsOptions, type OperatorStore } from "./store.js";
import type { OperatorPolicy } from "./policy.js";
import type { Bill } from "./types.js";

/** Minimal SQL surface; postgres.js `sql` satisfies it via `sql.unsafe`. */
export interface SqlClient {
  unsafe(query: string, params?: unknown[]): Promise<ReadonlyArray<Record<string, unknown>>>;
}

export const OPERATOR_TABLES = ["operator_decisions", "operator_escalations", "operator_bills", "operator_policies"] as const;

export const OPERATOR_SCHEMA_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS operator_decisions (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    seq integer NOT NULL,
    hash text NOT NULL,
    created_at timestamptz NOT NULL,
    metadata jsonb NOT NULL,
    UNIQUE (org_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS operator_escalations (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL,
    metadata jsonb NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS operator_escalations_org_status ON operator_escalations (org_id, status)`,
  `CREATE TABLE IF NOT EXISTS operator_bills (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    status text NOT NULL,
    due_at timestamptz NOT NULL,
    metadata jsonb NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS operator_bills_org_status ON operator_bills (org_id, status)`,
  `CREATE TABLE IF NOT EXISTS operator_policies (
    id text PRIMARY KEY,
    org_id text NOT NULL,
    updated_at timestamptz NOT NULL,
    metadata jsonb NOT NULL
  )`,
];

function toMetadata(entity: unknown): string {
  return JSON.stringify(packDoc(toJsonValue(entity)));
}

function fromRow<T>(row: Record<string, unknown>): T | null {
  const raw = row.metadata;
  const metadata = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
  const doc = unpackDoc<unknown>({ metadata });
  return doc === null ? null : fromJsonValue<T>(doc);
}

function fromRows<T>(rows: ReadonlyArray<Record<string, unknown>>): T[] {
  return rows.map((r) => fromRow<T>(r)).filter((d): d is NonNullable<typeof d> => d !== null) as T[];
}

export class PgOperatorStore implements OperatorStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly sql: SqlClient) {}

  /** Create the operator tables if missing. Idempotent; memoized per instance. */
  ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        for (const statement of OPERATOR_SCHEMA_SQL) await this.sql.unsafe(statement);
      })().catch((error: unknown) => {
        this.ready = null;
        throw error;
      });
    }
    return this.ready;
  }

  private async query(text: string, params: unknown[] = []): Promise<ReadonlyArray<Record<string, unknown>>> {
    await this.ensureSchema();
    return this.sql.unsafe(text, params);
  }

  async appendDecision(record: DecisionRecord): Promise<DecisionRecord> {
    assertLinks(await this.headDecision(record.orgId), record);
    await this.query(
      `INSERT INTO operator_decisions (id, org_id, seq, hash, created_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [record.id, record.orgId, record.seq, record.hash, record.createdAt, toMetadata(record)],
    );
    return record;
  }

  async getDecision(orgId: string, id: string): Promise<DecisionRecord | null> {
    const rows = await this.query(`SELECT metadata FROM operator_decisions WHERE org_id = $1 AND id = $2`, [orgId, id]);
    return rows[0] ? fromRow<DecisionRecord>(rows[0]) : null;
  }

  async listDecisions(orgId: string, options: ListDecisionsOptions = {}): Promise<readonly DecisionRecord[]> {
    const limit = options.limit ?? 1000;
    const rows = await this.query(
      `SELECT metadata FROM operator_decisions WHERE org_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
      [orgId, options.afterSeq ?? -1, limit],
    );
    return fromRows<DecisionRecord>(rows);
  }

  async headDecision(orgId: string): Promise<DecisionRecord | null> {
    const rows = await this.query(
      `SELECT metadata FROM operator_decisions WHERE org_id = $1 ORDER BY seq DESC LIMIT 1`,
      [orgId],
    );
    return rows[0] ? fromRow<DecisionRecord>(rows[0]) : null;
  }

  async saveEscalation(e: Escalation): Promise<Escalation> {
    await this.query(
      `INSERT INTO operator_escalations (id, org_id, status, created_at, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, metadata = EXCLUDED.metadata`,
      [e.id, e.orgId, e.status, e.createdAt, toMetadata(e)],
    );
    return e;
  }

  async getEscalation(orgId: string, id: string): Promise<Escalation | null> {
    const rows = await this.query(`SELECT metadata FROM operator_escalations WHERE org_id = $1 AND id = $2`, [orgId, id]);
    return rows[0] ? fromRow<Escalation>(rows[0]) : null;
  }

  async listEscalations(orgId: string, status?: EscalationStatus): Promise<readonly Escalation[]> {
    const rows = status
      ? await this.query(
          `SELECT metadata FROM operator_escalations WHERE org_id = $1 AND status = $2 ORDER BY created_at ASC`,
          [orgId, status],
        )
      : await this.query(`SELECT metadata FROM operator_escalations WHERE org_id = $1 ORDER BY created_at ASC`, [orgId]);
    return fromRows<Escalation>(rows);
  }

  async saveBill(bill: Bill): Promise<Bill> {
    await this.query(
      `INSERT INTO operator_bills (id, org_id, status, due_at, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, due_at = EXCLUDED.due_at, metadata = EXCLUDED.metadata`,
      [bill.id, bill.orgId, bill.status, bill.dueAt, toMetadata(bill)],
    );
    return bill;
  }

  async getBill(orgId: string, id: string): Promise<Bill | null> {
    const rows = await this.query(`SELECT metadata FROM operator_bills WHERE org_id = $1 AND id = $2`, [orgId, id]);
    return rows[0] ? fromRow<Bill>(rows[0]) : null;
  }

  async listBills(orgId: string, status?: Bill["status"]): Promise<readonly Bill[]> {
    const rows = status
      ? await this.query(
          `SELECT metadata FROM operator_bills WHERE org_id = $1 AND status = $2 ORDER BY due_at ASC`,
          [orgId, status],
        )
      : await this.query(`SELECT metadata FROM operator_bills WHERE org_id = $1 ORDER BY due_at ASC`, [orgId]);
    return fromRows<Bill>(rows);
  }

  async listOrgIds(): Promise<readonly string[]> {
    const rows = await this.query(
      `SELECT DISTINCT org_id FROM (
         SELECT org_id FROM operator_decisions UNION SELECT org_id FROM operator_escalations
         UNION SELECT org_id FROM operator_bills UNION SELECT org_id FROM operator_policies
       ) AS orgs ORDER BY org_id ASC`,
    );
    return rows.map((r) => String(r.org_id));
  }

  async getPolicy(orgId: string): Promise<OperatorPolicy | null> {
    const rows = await this.query(`SELECT metadata FROM operator_policies WHERE org_id = $1 AND id = $2`, [orgId, orgId]);
    return rows[0] ? fromRow<OperatorPolicy>(rows[0]) : null;
  }

  async savePolicy(orgId: string, policy: OperatorPolicy): Promise<OperatorPolicy> {
    await this.query(
      `INSERT INTO operator_policies (id, org_id, updated_at, metadata)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, metadata = EXCLUDED.metadata`,
      [orgId, orgId, new Date().toISOString(), toMetadata(policy)],
    );
    return policy;
  }
}
