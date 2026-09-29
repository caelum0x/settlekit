/**
 * Operator persistence: decisions (hash-chained), escalations and bills.
 *
 * `InMemoryOperatorStore` is a full working store for dev/tests; the Postgres
 * store lives in ./pg-store.ts. Both enforce the decision chain on append: a
 * record must link to the org's current head (optimistic concurrency), so two
 * writers can never fork the log.
 */
import { GENESIS_HASH, type DecisionRecord } from "./decision-log.js";
import type { Escalation, EscalationStatus } from "./escalation.js";
import type { OperatorPolicy } from "./policy.js";
import type { Bill } from "./types.js";

export interface ListDecisionsOptions {
  /** Only records with seq > afterSeq. */
  readonly afterSeq?: number;
  readonly limit?: number;
}

export interface OperatorStore {
  appendDecision(record: DecisionRecord): Promise<DecisionRecord>;
  getDecision(orgId: string, id: string): Promise<DecisionRecord | null>;
  /** Decisions for an org in chain order (seq ascending). */
  listDecisions(orgId: string, options?: ListDecisionsOptions): Promise<readonly DecisionRecord[]>;
  headDecision(orgId: string): Promise<DecisionRecord | null>;

  saveEscalation(escalation: Escalation): Promise<Escalation>;
  getEscalation(orgId: string, id: string): Promise<Escalation | null>;
  listEscalations(orgId: string, status?: EscalationStatus): Promise<readonly Escalation[]>;

  saveBill(bill: Bill): Promise<Bill>;
  getBill(orgId: string, id: string): Promise<Bill | null>;
  listBills(orgId: string, status?: Bill["status"]): Promise<readonly Bill[]>;

  /** Orgs that have at least one decision, escalation, bill or policy. */
  listOrgIds(): Promise<readonly string[]>;
  getPolicy(orgId: string): Promise<OperatorPolicy | null>;
  savePolicy(orgId: string, policy: OperatorPolicy): Promise<OperatorPolicy>;
}

export class ChainConflictError extends Error {
  constructor(orgId: string, detail: string) {
    super(`decision chain conflict for org ${orgId}: ${detail}`);
    this.name = "ChainConflictError";
  }
}

/** Throw unless `record` is the valid next link after `head`. */
export function assertLinks(head: DecisionRecord | null, record: DecisionRecord): void {
  const expectedSeq = head ? head.seq + 1 : 0;
  const expectedPrev = head ? head.hash : GENESIS_HASH;
  if (record.seq !== expectedSeq) throw new ChainConflictError(record.orgId, `expected seq ${expectedSeq}, got ${record.seq}`);
  if (record.prevHash !== expectedPrev) throw new ChainConflictError(record.orgId, "prevHash is not the current head");
}

export class InMemoryOperatorStore implements OperatorStore {
  private decisions: readonly DecisionRecord[] = [];
  private escalations: ReadonlyMap<string, Escalation> = new Map();
  private bills: ReadonlyMap<string, Bill> = new Map();
  private policies: ReadonlyMap<string, OperatorPolicy> = new Map();

  async appendDecision(record: DecisionRecord): Promise<DecisionRecord> {
    assertLinks(await this.headDecision(record.orgId), record);
    if (this.decisions.some((d) => d.id === record.id)) {
      throw new ChainConflictError(record.orgId, `duplicate decision id ${record.id}`);
    }
    this.decisions = [...this.decisions, record];
    return record;
  }

  async getDecision(orgId: string, id: string): Promise<DecisionRecord | null> {
    return this.decisions.find((d) => d.orgId === orgId && d.id === id) ?? null;
  }

  async listDecisions(orgId: string, options: ListDecisionsOptions = {}): Promise<readonly DecisionRecord[]> {
    const after = options.afterSeq ?? -1;
    const rows = this.decisions.filter((d) => d.orgId === orgId && d.seq > after).sort((a, b) => a.seq - b.seq);
    return options.limit === undefined ? rows : rows.slice(0, options.limit);
  }

  async headDecision(orgId: string): Promise<DecisionRecord | null> {
    const rows = await this.listDecisions(orgId);
    return rows[rows.length - 1] ?? null;
  }

  async saveEscalation(escalation: Escalation): Promise<Escalation> {
    this.escalations = new Map([...this.escalations, [escalation.id, escalation]]);
    return escalation;
  }

  async getEscalation(orgId: string, id: string): Promise<Escalation | null> {
    const e = this.escalations.get(id);
    return e && e.orgId === orgId ? e : null;
  }

  async listEscalations(orgId: string, status?: EscalationStatus): Promise<readonly Escalation[]> {
    return [...this.escalations.values()]
      .filter((e) => e.orgId === orgId && (status === undefined || e.status === status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveBill(bill: Bill): Promise<Bill> {
    const stored = Object.freeze({ ...bill });
    this.bills = new Map([...this.bills, [stored.id, stored]]);
    return stored;
  }

  async getBill(orgId: string, id: string): Promise<Bill | null> {
    const b = this.bills.get(id);
    return b && b.orgId === orgId ? b : null;
  }

  async listBills(orgId: string, status?: Bill["status"]): Promise<readonly Bill[]> {
    return [...this.bills.values()]
      .filter((b) => b.orgId === orgId && (status === undefined || b.status === status))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }

  async listOrgIds(): Promise<readonly string[]> {
    const ids = [
      ...this.decisions.map((d) => d.orgId),
      ...[...this.escalations.values()].map((e) => e.orgId),
      ...[...this.bills.values()].map((b) => b.orgId),
      ...this.policies.keys(),
    ];
    return [...new Set(ids)].sort();
  }

  async getPolicy(orgId: string): Promise<OperatorPolicy | null> {
    return this.policies.get(orgId) ?? null;
  }

  async savePolicy(orgId: string, policy: OperatorPolicy): Promise<OperatorPolicy> {
    const stored = Object.freeze({ ...policy, allowlist: [...policy.allowlist] });
    this.policies = new Map([...this.policies, [orgId, stored]]);
    return stored;
  }
}
