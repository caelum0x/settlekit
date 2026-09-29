/**
 * Operator routes over Hono's app.request(), with a real operator runtime
 * (in-memory store, LocalExecutor vault simulation, heuristic engine) and the
 * real API-key auth middleware. Mounted exactly as app.ts mounts them: before
 * the API-key-guarded v1 group.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";
import { createOperatorRuntime, LocalExecutor, type OperatorRuntime } from "@settlekit/operator";
import type { AppContext, AppEnv } from "../src/context.js";
import { error } from "../src/http/respond.js";
import { authMiddleware } from "../src/middleware/auth.js";
import { operatorRoutes } from "../src/routes/operator.js";

const BOOTSTRAP = "operator-bootstrap";
const AGENT_KEY = "sk_agent";
const OTHER_ORG_KEY = "sk_other";
const VENDOR = "0x00000000000000000000000000000000007e2d02";
const STRANGER = "0x0000000000000000000000000000000000000bad";
const U = 1_000_000n;
const T0 = new Date("2026-10-04T12:00:00.000Z");

const fakeCtx = {
  apiKeys: {
    verify: async (key: string) =>
      key === AGENT_KEY
        ? { valid: true, apiKey: { id: "key_agent", organizationId: DEFAULT_ORG_ID } }
        : key === OTHER_ORG_KEY
          ? { valid: true, apiKey: { id: "key_other", organizationId: "org_other" } }
          : { valid: false },
    recordUsage: async () => undefined,
  },
  auth: { authenticateSession: async () => ({ ok: false }) },
} as unknown as AppContext;

interface Setup {
  readonly app: Hono<AppEnv>;
  readonly runtime: OperatorRuntime;
  readonly vault: LocalExecutor;
}

function setup(): Setup {
  process.env.API_BOOTSTRAP_KEY = BOOTSTRAP;
  const vault = new LocalExecutor({ caps: { perTxCap: 1000n * U, dailyCap: 1500n * U, escalateAbove: 500n * U }, allowlist: [VENDOR], now: () => T0 });
  const runtime = createOperatorRuntime({ OPERATOR_ALLOWLIST: VENDOR }, DEFAULT_ORG_ID, { executor: vault, owner: vault, now: () => T0 });
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("ctx", fakeCtx);
    await next();
  });
  app.route("/", operatorRoutes({ runtime: () => runtime, proofTtlMs: 0 }));
  const v1 = new Hono<AppEnv>();
  v1.use("*", authMiddleware());
  v1.get("/anything", (c) => c.json({ data: "guarded" }));
  app.route("/v1", v1);
  app.onError((err, c) => error(c, err));
  return { app, runtime, vault };
}

async function call(app: Hono<AppEnv>, method: string, path: string, body?: unknown, key: string | null = BOOTSTRAP) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as { data?: any; error?: { code: string; message: string; details?: any } } };
}

const sale = (id = "evt_sale_1", amount = 2000n * U) => ({ type: "revenue.received", id, at: T0.toISOString(), amount: amount.toString(), payer: "0x00000000000000000000000000000000000000aa", paymentRef: "0xpay" });

describe("operator routes", () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
    s.vault.deposit(2000n * U);
  });

  it("requires a credential and scopes to the operator org", async () => {
    expect((await call(s.app, "GET", "/v1/operator/decisions", undefined, null)).status).toBe(401);
    expect((await call(s.app, "GET", "/v1/operator/decisions", undefined, OTHER_ORG_KEY)).status).toBe(403);
    expect((await call(s.app, "GET", "/v1/anything", undefined, null)).status).toBe(401);
  });

  it("handles an event once, forcing the caller's org, and replays duplicates", async () => {
    const first = await call(s.app, "POST", "/v1/operator/events", { ...sale(), orgId: "org_attacker" }, AGENT_KEY);
    expect(first.status).toBe(201);
    expect(first.json.data).toMatchObject({ orgId: DEFAULT_ORG_ID, outcome: "executed", seq: 0 });
    const replay = await call(s.app, "POST", "/v1/operator/events", sale(), AGENT_KEY);
    expect(replay.status).toBe(200);
    expect(replay.json.data.id).toBe(first.json.data.id);
    const bad = await call(s.app, "POST", "/v1/operator/events", { type: "revenue.received", id: "x" }, AGENT_KEY);
    expect(bad.status).toBe(400);
    expect(bad.json.error?.details.issues.length).toBeGreaterThan(0);

    const list = await call(s.app, "GET", "/v1/operator/decisions?limit=10");
    expect(list.json.data).toHaveLength(1);
    const one = await call(s.app, "GET", `/v1/operator/decisions/${first.json.data.id}`);
    expect(one.json.data.hash).toBe(first.json.data.hash);
    expect((await call(s.app, "GET", "/v1/operator/decisions/nope")).status).toBe(404);
  });

  it("takes bills, escalates unknown payees, and lets only the owner approve or reject", async () => {
    await call(s.app, "POST", "/v1/operator/events", sale(), AGENT_KEY);
    const paid = await call(s.app, "POST", "/v1/operator/bills", { payee: VENDOR, amountUsdc: "120", dueAt: T0.toISOString(), description: "Hosting" }, AGENT_KEY);
    expect(paid.status).toBe(201);
    expect(paid.json.data.bill.status).toBe("paid");
    const unknown = await call(s.app, "POST", "/v1/operator/bills", { payee: STRANGER, amountUsdc: "75", dueAt: T0.toISOString(), description: "New contractor" }, AGENT_KEY);
    expect(unknown.json.data.decision.outcome).toBe("escalated");
    expect((await call(s.app, "POST", "/v1/operator/bills", { payee: "nope", amountUsdc: "x", dueAt: "y", description: "" })).status).toBe(400);
    expect((await call(s.app, "POST", "/v1/operator/bills", { invoiceText: "Invoice" })).json.error?.message).toMatch(/ANTHROPIC_API_KEY/);

    const pending = await call(s.app, "GET", "/v1/operator/escalations?status=pending");
    const id = pending.json.data[0].id as string;
    expect((await call(s.app, "POST", `/v1/operator/escalations/${id}/reject`, { reason: "unknown" }, AGENT_KEY)).status).toBe(403);
    const rejected = await call(s.app, "POST", `/v1/operator/escalations/${id}/reject`, { reason: "not a vendor we use" });
    expect(rejected.json.data).toMatchObject({ model: "owner", outcome: "denied" });
    expect((await call(s.app, "POST", `/v1/operator/escalations/${id}/approve`)).status).toBe(409);
    expect((await call(s.app, "POST", `/v1/operator/escalations/missing/approve`)).status).toBe(404);
    expect((await call(s.app, "GET", "/v1/operator/bills?status=rejected")).json.data).toHaveLength(1);
  });

  it("approves a vault escalation above the threshold", async () => {
    await call(s.app, "POST", "/v1/operator/events", sale(), AGENT_KEY);
    const big = await call(s.app, "POST", "/v1/operator/bills", { payee: VENDOR, amountUsdc: "600", dueAt: T0.toISOString(), description: "Annual" }, AGENT_KEY);
    expect(big.json.data.decision.outcome).toBe("escalated");
    const [pending] = (await call(s.app, "GET", "/v1/operator/escalations?status=pending")).json.data;
    expect(pending.vaultEscalationId).toBe(1);
    const approved = await call(s.app, "POST", `/v1/operator/escalations/${pending.id}/approve`);
    expect(approved.json.data.outcome).toBe("executed");
    expect(s.vault.escalation(1)?.status).toBe("Approved");
  });

  it("serves policy and refuses drift from the vault", async () => {
    const got = await call(s.app, "GET", "/v1/operator/policy", undefined, AGENT_KEY);
    expect(got.json.data).toMatchObject({ executor: "local-simulation", engine: "heuristic", drift: [] });
    expect(got.json.data.policy.perTxCap).toBe("1000");
    const body = { ...got.json.data.policy, minFloat: "50" };
    expect((await call(s.app, "PUT", "/v1/operator/policy", body, AGENT_KEY)).status).toBe(403);
    const drift = await call(s.app, "PUT", "/v1/operator/policy", { ...body, dailyCap: "9000" });
    expect(drift.status).toBe(409);
    expect(drift.json.error?.details.drift[0]).toMatch(/dailyCap/);
    expect((await call(s.app, "PUT", "/v1/operator/policy", { ...body, split: { OPERATING: 1 } })).status).toBe(400);
    const saved = await call(s.app, "PUT", "/v1/operator/policy", body);
    expect(saved.json.data.policy.minFloat).toBe("50");
  });

  it("publishes proof and verification without a key", async () => {
    const decision = (await call(s.app, "POST", "/v1/operator/events", sale(), AGENT_KEY)).json.data;
    const proof = await call(s.app, "GET", "/v1/public/operator/proof", undefined, null);
    expect(proof.status).toBe(200);
    expect(proof.json.data).toMatchObject({ orgs: 1, usdcIn: expect.stringMatching(/^2000/), executor: "local-simulation", decisions: { total: 1, executed: 1 } });
    const verify = await call(s.app, "GET", `/v1/public/operator/verify/${decision.id}`, undefined, null);
    expect(verify.json.data).toMatchObject({ valid: true, commitment: "match", chain: { valid: true }, onChain: "not_configured" });
    expect((await call(s.app, "GET", "/v1/public/operator/verify/nope", undefined, null)).status).toBe(404);
  });
});

describe("operator routes without configuration", () => {
  it("answers 503 instead of silently simulating", async () => {
    const saved = { vault: process.env.OPERATOR_VAULT_ADDRESS, sim: process.env.OPERATOR_SIMULATION };
    delete process.env.OPERATOR_VAULT_ADDRESS;
    delete process.env.OPERATOR_SIMULATION;
    try {
      const app = new Hono<AppEnv>();
      app.route("/", operatorRoutes());
      app.onError((err, c) => error(c, err));
      const res = await app.request("/v1/public/operator/proof");
      expect(res.status).toBe(503);
    } finally {
      if (saved.vault !== undefined) process.env.OPERATOR_VAULT_ADDRESS = saved.vault;
      if (saved.sim !== undefined) process.env.OPERATOR_SIMULATION = saved.sim;
    }
  });
});
