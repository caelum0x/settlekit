import { describe, expect, it } from "vitest";
import { proposal } from "../src/actions.js";
import { DecisionLog, digest, verifyChain, type DecisionInput } from "../src/decision-log.js";
import { openEscalation } from "../src/escalation.js";
import { OPERATOR_SCHEMA_SQL, PgOperatorStore } from "../src/pg-store.js";
import { ChainConflictError, InMemoryOperatorStore, type OperatorStore } from "../src/store.js";
import type { Bill } from "../src/types.js";
import { FakeSql } from "./fake-sql.js";
import { T0, U, VENDOR } from "./fixtures.js";

const input = (n: number, orgId = "org_1"): DecisionInput => ({
  id: `${orgId}_dec_${n}`,
  orgId,
  eventRef: `evt_${n}`,
  model: "heuristic-v1",
  inputsDigest: digest(n),
  toolCalls: [],
  policyVerdict: { decision: "allow", reasons: [], spentToday: BigInt(n) * U },
  rationale: "r",
  alternatives: [],
  confidence: 1,
  outcome: "executed",
  txHash: n % 2 === 0 ? `0x${n}` : undefined,
  createdAt: new Date(T0.getTime() + n * 1000).toISOString(),
});

const bill = (id: string, dueAt: string, status: Bill["status"] = "open"): Bill => ({
  id, orgId: "org_1", payee: VENDOR, amount: 42n * U, dueAt, description: "hosting", status, createdAt: T0.toISOString(),
});

function contract(name: string, make: () => OperatorStore) {
  describe(name, () => {
    it("appends a verifiable chain per org and lists in order", async () => {
      const store = make();
      let log = new DecisionLog();
      for (let i = 0; i < 12; i++) {
        log = log.append(input(i));
        await store.appendDecision(log.head!);
      }
      await store.appendDecision(new DecisionLog().append(input(0, "org_2")).head!);

      const listed = await store.listDecisions("org_1");
      expect(listed.map((d) => d.seq)).toEqual([...Array(12).keys()]);
      expect(verifyChain(listed).valid).toBe(true);
      expect(listed[3]).toEqual(log.records[3]);
      expect((await store.listDecisions("org_1", { afterSeq: 9 })).map((d) => d.seq)).toEqual([10, 11]);
      expect(await store.listDecisions("org_1", { limit: 2 })).toHaveLength(2);
      expect((await store.headDecision("org_1"))?.seq).toBe(11);
      expect((await store.getDecision("org_1", "org_1_dec_4"))?.policyVerdict?.spentToday).toBe(4n * U);
      expect(await store.getDecision("org_2", "org_1_dec_4")).toBeNull();
      expect(await store.headDecision("org_3")).toBeNull();
    });

    it("rejects records that would fork the chain", async () => {
      const store = make();
      const log = new DecisionLog().append(input(0)).append(input(1));
      await expect(store.appendDecision(log.records[1]!)).rejects.toThrow(ChainConflictError);
      await store.appendDecision(log.records[0]!);
      await expect(store.appendDecision(log.records[0]!)).rejects.toThrow(ChainConflictError);
      const fork = new DecisionLog([log.records[0]!]).append({ ...input(1), id: "other" });
      await store.appendDecision(log.records[1]!);
      await expect(store.appendDecision(fork.head!)).rejects.toThrow(ChainConflictError);
    });

    it("upserts escalations and filters by status", async () => {
      const store = make();
      const p = proposal({ kind: "payout", bucket: "OPERATING", to: VENDOR, amount: 800n * U, ref: "b" }, "r", [], 0.7);
      const e = openEscalation({ id: "esc_1", orgId: "org_1", decisionId: "d", proposal: p, reasons: ["x"], vaultEscalationId: 3 }, T0);
      await store.saveEscalation(e);
      await store.saveEscalation(openEscalation({ id: "esc_2", orgId: "org_1", decisionId: "d", proposal: p, reasons: [] }, new Date(T0.getTime() + 1)));
      await store.saveEscalation({ ...e, status: "approved" });
      expect((await store.listEscalations("org_1", "pending")).map((x) => x.id)).toEqual(["esc_2"]);
      expect((await store.listEscalations("org_1")).map((x) => x.id)).toEqual(["esc_1", "esc_2"]);
      const loaded = await store.getEscalation("org_1", "esc_1");
      expect(loaded?.status).toBe("approved");
      expect(loaded?.proposal.action).toEqual(p.action);
      expect(await store.getEscalation("org_2", "esc_1")).toBeNull();
    });

    it("upserts bills ordered by due date", async () => {
      const store = make();
      await store.saveBill(bill("b2", "2026-10-09T00:00:00.000Z"));
      await store.saveBill(bill("b1", "2026-10-05T00:00:00.000Z"));
      await store.saveBill(bill("b2", "2026-10-09T00:00:00.000Z", "paid"));
      expect((await store.listBills("org_1")).map((b) => b.id)).toEqual(["b1", "b2"]);
      expect((await store.listBills("org_1", "open")).map((b) => b.id)).toEqual(["b1"]);
      expect((await store.getBill("org_1", "b1"))?.amount).toBe(42n * U);
      expect(await store.getBill("org_2", "b1")).toBeNull();
    });
  });
}

contract("InMemoryOperatorStore", () => new InMemoryOperatorStore());
contract("PgOperatorStore (fake SQL)", () => new PgOperatorStore(new FakeSql()));

describe("PgOperatorStore specifics", () => {
  it("self-creates its three jsonb tables once, without drizzle", async () => {
    const sql = new FakeSql();
    const store = new PgOperatorStore(sql);
    await store.listBills("org_1");
    await store.listBills("org_1");
    const creates = sql.statements.filter((s) => s.startsWith("CREATE"));
    expect(creates).toHaveLength(OPERATOR_SCHEMA_SQL.length);
    for (const t of ["operator_decisions", "operator_escalations", "operator_bills"]) {
      expect(creates.some((s) => s.includes(`CREATE TABLE IF NOT EXISTS ${t}`) && s.includes("metadata jsonb"))).toBe(true);
    }
  });

  it("retries schema creation after a failure", async () => {
    const sql = new FakeSql();
    const store = new PgOperatorStore(sql);
    sql.failNext = new Error("connection refused");
    await expect(store.ensureSchema()).rejects.toThrow("connection refused");
    await expect(store.ensureSchema()).resolves.toBeUndefined();
  });

  it("stores the doc under metadata.__doc with tagged bigints, and reads string jsonb", async () => {
    const rows: Record<string, unknown>[] = [];
    const sql = {
      async unsafe(query: string, params: unknown[] = []) {
        if (query.startsWith("INSERT")) rows.push({ metadata: params[4] });
        if (query.startsWith("SELECT")) return rows;
        return [];
      },
    };
    const store = new PgOperatorStore(sql);
    await store.saveBill(bill("b1", "2026-10-05T00:00:00.000Z"));
    const stored = JSON.parse(String(rows[0]!.metadata));
    expect(stored.__doc.amount).toEqual({ $bigint: "42000000" });
    expect((await store.getBill("org_1", "b1"))?.amount).toBe(42n * U);
    rows[0] = { metadata: { other: 1 } };
    expect(await store.listBills("org_1")).toEqual([]);
  });
});
