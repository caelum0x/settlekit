/**
 * Autonomous operator routes (SettleKit Operator on Arc).
 *
 * Authenticated (Bearer API key or dashboard session), scoped to the org the
 * operator vault is configured for:
 *   POST /v1/operator/events                     handle a business event
 *   GET  /v1/operator/decisions                  hash-chained decision log
 *   GET  /v1/operator/decisions/:id              one decision
 *   POST /v1/operator/bills                      AP intake (manual or invoice text)
 *   GET  /v1/operator/bills                      bills (?status=)
 *   GET  /v1/operator/escalations                escalations (?status=)
 *   POST /v1/operator/escalations/:id/approve    owner only
 *   POST /v1/operator/escalations/:id/reject     owner only
 *   GET  /v1/operator/policy                     policy + on-chain drift
 *   PUT  /v1/operator/policy                     owner only; refuses drift
 *
 * Public (no key):
 *   GET  /v1/public/operator/proof               live aggregates (demo org excluded)
 *   GET  /v1/public/operator/verify/:id          recompute chain + check Arc anchor
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  findDecisionByEventRef,
  parseOperatorEvent,
  policyView,
  type Bill,
  type EscalationStatus,
  type OperatorProof,
  type OperatorRuntime,
} from "@settlekit/operator";
import type { AppEnv } from "../context.js";
import { authMiddleware } from "../middleware/auth.js";
import { created, data } from "../http/respond.js";
import { parseBody, validate } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";
import { getOperatorRuntime } from "../operator/runtime.js";
import { SingleFlight, TtlCache, forbidden, isOwner, jsonView, notFound, ownerId, toHttpError } from "../operator/http.js";

export interface OperatorRouteOptions {
  readonly runtime?: () => OperatorRuntime;
  readonly auth?: MiddlewareHandler<AppEnv>;
  readonly proofTtlMs?: number;
}

const listSchema = z.object({
  afterSeq: z.coerce.number().int().min(-1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
const billSchema = z.union([
  z.object({ invoiceText: z.string().min(1).max(50_000) }),
  z.object({
    payee: z.string(),
    amountUsdc: z.string(),
    dueAt: z.string(),
    description: z.string(),
    vendor: z.string().max(200).optional(),
  }),
]);
const billStatus = z.object({ status: z.enum(["open", "paid", "escalated", "rejected"]).optional() });
const escalationStatus = z.object({ status: z.enum(["pending", "approved", "rejected", "expired"]).optional() });
const rejectSchema = z.object({ reason: z.string().min(1).max(1000) });

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw toHttpError(err);
  }
}

function privateRoutes(runtime: () => OperatorRuntime): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const flight = new SingleFlight();

  /** The operator acts for exactly one org: the one its vault belongs to. */
  const org = (c: Context<AppEnv>): string => {
    const orgId = requireOrg(c);
    if (orgId !== runtime().config.orgId) throw forbidden("The operator is not enabled for this organization");
    return orgId;
  };
  const owner = (c: Context<AppEnv>): void => {
    if (!isOwner(c)) throw forbidden("Only the organization owner can do this");
  };

  app.post("/events", async (c) => {
    const orgId = org(c);
    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    return guarded(async () => {
      const event = parseOperatorEvent(raw && typeof raw === "object" ? { ...raw, orgId } : raw);
      const rt = runtime();
      const decision = await flight.run(`${orgId}:${event.id}`, async () => {
        const existing = await findDecisionByEventRef(rt.store, orgId, event.id);
        return existing ? { record: existing, replay: true } : { record: await rt.service.handle(event), replay: false };
      });
      return decision.replay ? data(c, jsonView(decision.record)) : created(c, jsonView(decision.record));
    });
  });

  app.get("/decisions", async (c) => {
    const orgId = org(c);
    const q = validate(listSchema, c.req.query());
    const records = await runtime().store.listDecisions(orgId, { afterSeq: q.afterSeq ?? -1, limit: q.limit ?? 100 });
    return data(c, jsonView(records));
  });

  app.get("/decisions/:id", async (c) => {
    const record = await runtime().store.getDecision(org(c), c.req.param("id"));
    if (!record) throw notFound("Decision not found");
    return data(c, jsonView(record));
  });

  app.post("/bills", async (c) => {
    const orgId = org(c);
    const body = await parseBody(c, billSchema);
    return guarded(async () => {
      const intake = runtime().intake;
      const result = "invoiceText" in body ? await intake.fromInvoiceText(orgId, body.invoiceText) : await intake.manual(orgId, body);
      return created(c, jsonView(result));
    });
  });

  app.get("/bills", async (c) => {
    const q = validate(billStatus, c.req.query());
    const bills: readonly Bill[] = await runtime().store.listBills(org(c), q.status);
    return data(c, jsonView(bills));
  });

  app.get("/escalations", async (c) => {
    const q = validate(escalationStatus, c.req.query());
    return data(c, jsonView(await runtime().store.listEscalations(org(c), q.status as EscalationStatus | undefined)));
  });

  app.post("/escalations/:id/approve", async (c) => {
    const orgId = org(c);
    owner(c);
    const id = c.req.param("id");
    return guarded(async () => data(c, jsonView(await flight.run(`esc:${id}`, () => runtime().service.approve(orgId, id, ownerId(c))))));
  });

  app.post("/escalations/:id/reject", async (c) => {
    const orgId = org(c);
    owner(c);
    const body = await parseBody(c, rejectSchema);
    const id = c.req.param("id");
    return guarded(async () => data(c, jsonView(await flight.run(`esc:${id}`, () => runtime().service.reject(orgId, id, ownerId(c), body.reason)))));
  });

  app.get("/policy", async (c) => {
    const rt = runtime();
    const policy = await rt.policy.get(org(c));
    return data(c, { policy: policyView(policy), drift: await rt.policy.drift(policy), executor: rt.executorKind, engine: rt.engineName, vault: rt.config.vault?.address ?? null });
  });

  app.put("/policy", async (c) => {
    const orgId = org(c);
    owner(c);
    const body = (await c.req.json().catch(() => null)) as unknown;
    return guarded(async () => data(c, { policy: policyView(await runtime().policy.put(orgId, body)) }));
  });

  return app;
}

function publicRoutes(runtime: () => OperatorRuntime, ttlMs: number): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const cache = new TtlCache<OperatorProof>(ttlMs);

  app.get("/proof", async (c) => {
    const rt = runtime();
    const proof = await cache.get(() => rt.proof());
    return data(c, { ...proof, network: "arc-testnet", executor: rt.executorKind, vault: rt.config.vault?.address ?? null });
  });

  app.get("/verify/:id", async (c) => {
    const result = await runtime().verify(c.req.param("id"));
    if (!result) throw notFound("Decision not found");
    return data(c, jsonView(result));
  });

  return app;
}

/** Mount at "/" (outside the v1 API-key group): serves both prefixes. */
export function operatorRoutes(options: OperatorRouteOptions = {}): Hono<AppEnv> {
  const runtime = options.runtime ?? getOperatorRuntime;
  const app = new Hono<AppEnv>();
  app.route("/v1/public/operator", publicRoutes(runtime, options.proofTtlMs ?? 30_000));
  const operator = new Hono<AppEnv>();
  operator.use("*", options.auth ?? authMiddleware());
  operator.route("/", privateRoutes(runtime));
  app.route("/v1/operator", operator);
  return app;
}
