/**
 * Lepton Agents Hackathon demo routes (PUBLIC — no API key).
 *
 * A self-contained, clickable surface that exercises the three hackathon
 * modules end to end on Arc-style nanopayments, with in-memory settlement so it
 * runs anywhere:
 *
 *   GET  /v1/lepton                  overview + RFB mapping
 *   GET  /v1/lepton/sources          discoverable citation-toll listings
 *   GET  /v1/lepton/articles/:id     x402-gated content (returns a 402 challenge)
 *   GET  /v1/lepton/economy/run      run the autonomous agent economy, get a report
 *   GET  /v1/lepton/stream/demo      per-second streaming settlement demo
 *
 * Modules: @settlekit/agent (autonomous paying agent, RFB 1/3),
 * @settlekit/citation-toll (per-access content + recursive royalties, RFB 6),
 * @settlekit/streaming (per-second settlement, RFB 4).
 */
import { Hono } from "hono";
import { defaultDecisionEngine } from "@settlekit/agent";
import { runAgentEconomy, seedLeptonSources } from "@settlekit/agent-economy";
import {
  InMemorySourceRegistry,
  createCitationTollRouter,
  toAgentServiceListing,
} from "@settlekit/citation-toll";
import { createLocalSettlement } from "@settlekit/x402-client";
import { openStream } from "@settlekit/streaming";
import type { AppEnv } from "../context.js";

const SOURCES = seedLeptonSources();

// One registry + local settlement powering the x402-gated /articles endpoints.
const registry = new InMemorySourceRegistry();
for (const source of SOURCES) {
  registry.add(source);
}
const articleSettlement = createLocalSettlement();
const tollRouter = createCitationTollRouter(registry, { verify: articleSettlement.verify });

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value !== undefined ? Number(value) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Accept only a well-formed decimal amount; fall back otherwise (so malformed
 * query params can't reach `money()` and surface as a 500 on a public route). */
function safeAmount(value: string | undefined, fallback: string): string {
  return value !== undefined && /^\d+(\.\d+)?$/.test(value) ? value : fallback;
}

/** Public base URL for listings. Pinned via env so a forged Host header can't
 * poison the endpoint URLs returned to discovering agents. */
function leptonBaseUrl(requestUrl: string): string {
  const configured = process.env["LEPTON_BASE_URL"];
  if (configured !== undefined && configured.length > 0) {
    return `${configured.replace(/\/$/, "")}/v1/lepton`;
  }
  return `${new URL(requestUrl).origin}/v1/lepton`;
}

export function leptonRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) =>
    c.json({
      data: {
        name: "SettleKit × Lepton — nanopayments on Arc",
        modules: {
          agent: "Autonomous paying agent (Claude tool-use loop) — RFB 1 & 3",
          citationToll: "Per-access content with recursive royalty splits — RFB 6",
          streaming: "Per-second continuous-authorization settlement — RFB 4",
        },
        endpoints: {
          sources: "/v1/lepton/sources",
          article: "/v1/lepton/articles/:id",
          economyRun: "/v1/lepton/economy/run?agents=5&budget=0.005",
          streamDemo: "/v1/lepton/stream/demo?rate=0.001&reserve=0.01&seconds=6",
        },
      },
    }),
  );

  // Discoverable agent-service listings for every seed source.
  app.get("/sources", (c) => {
    const baseUrl = leptonBaseUrl(c.req.url);
    const listings = SOURCES.map((s) => toAgentServiceListing(s, { baseUrl }));
    return c.json({ data: { count: listings.length, services: listings } });
  });

  // x402-gated content. Without an X-Payment header this returns a 402 challenge
  // describing how to pay; the bundled agent economy demonstrates a full
  // pay-and-retry against the same protocol.
  app.all("/articles/:id", (c) => tollRouter(c.req.raw));

  // Run the closed-loop economy: N agents discover and pay citation tolls;
  // royalties settle recursively to authors. Defaults to the deterministic
  // heuristic engine. Because this endpoint is PUBLIC, Claude is opt-in only
  // (?engine=claude, requires ANTHROPIC_API_KEY) and capped at 3 agents so an
  // open endpoint cannot run up unbounded LLM spend. The CLI is the unbounded
  // Claude demo.
  app.get("/economy/run", async (c) => {
    const wantsClaude = c.req.query("engine") === "claude";
    const claudeReady = wantsClaude && Boolean(process.env["ANTHROPIC_API_KEY"]);
    const agents = clampInt(c.req.query("agents"), 5, 1, claudeReady ? 3 : 25);
    const budget = safeAmount(c.req.query("budget"), "0.005");
    const maxPrice = safeAmount(c.req.query("maxPrice"), "0.001");
    const maxPurchases = clampInt(c.req.query("maxPurchases"), 3, 1, 10);

    const report = await runAgentEconomy({
      sources: SOURCES,
      agentCount: agents,
      perAgentBudgetUsdc: budget,
      maxPriceUsdc: maxPrice,
      maxPurchasesPerAgent: maxPurchases,
      ...(claudeReady ? { makeEngine: () => defaultDecisionEngine() } : {}),
    });

    return c.json({
      data: {
        engine: claudeReady ? "claude (claude-opus-4-8)" : "heuristic",
        ...(wantsClaude && !claudeReady
          ? { note: "ANTHROPIC_API_KEY not configured on this deployment; ran heuristic engine." }
          : {}),
        report,
      },
    });
  });

  // Deterministic per-second streaming demo over a synthetic clock.
  app.get("/stream/demo", async (c) => {
    const rate = safeAmount(c.req.query("rate"), "0.001");
    const reserve = safeAmount(c.req.query("reserve"), "0.01");
    const seconds = clampInt(c.req.query("seconds"), 6, 1, 120);

    const ref = { t: 0 };
    const stream = openStream({
      payer: "0xviewer",
      payee: "0xstreamer",
      network: "arc",
      ratePerSecondUsdc: rate,
      reserveUsdc: reserve,
      now: () => ref.t,
    });

    const timeline: Array<{ second: number; accruedUsdc: string }> = [];
    for (let s = 1; s <= seconds; s += 1) {
      ref.t = s * 1000;
      // Simulate a one-second delivery outage at the midpoint (proof-of-flow).
      if (s === Math.ceil(seconds / 2)) {
        stream.reportFlow(false);
      } else {
        stream.reportFlow(true);
      }
      timeline.push({ second: s, accruedUsdc: stream.accrued().amount });
    }

    const { finalSettlement, refund } = await stream.close();
    return c.json({
      data: {
        ratePerSecondUsdc: rate,
        reserveUsdc: reserve,
        timeline,
        finalSettlementUsdc: finalSettlement.settledTotal.amount,
        refundUsdc: refund.amount,
        note: "Meter pauses during the simulated mid-stream outage (proof-of-flow); unused reserve is refunded.",
      },
    });
  });

  return app;
}
