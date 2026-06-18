/**
 * Assemble the RSSHub citation-toll sidecar: ingest RSS items as priced
 * sources, gate them behind x402, and settle per-citation royalties through the
 * production settlement spine.
 *
 * `createSidecar` builds the wired app (and exposes its parts for tests/ops);
 * `startSidecar` boots the HTTP server.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  InMemoryRoyaltyLegStore,
  InMemorySourceRegistry,
  type RoyaltyLegStore,
  createCitationTollRouter,
  sweepPendingRoyalties,
} from "@settlekit/citation-toll";
import { InMemoryPayeeRegistry, type PayeeRegistry } from "@settlekit/payee-registry";
import {
  LocalSettlementProvider,
  type SettlementProvider,
  settlementProviderFromEnv,
} from "@settlekit/settlement-core";
import {
  type Settler,
  createFetchIndexerClient,
  createLocalSettlement,
  createOnchainVerifier,
} from "@settlekit/x402-client";
import type { PaymentVerifier } from "@settlekit/x402";
import { type SidecarConfig, loadConfig } from "./config.js";
import { type RssCitationIngestor, type RssItem, createRssIngestor } from "./ingestor.js";
import { createTollDistributor } from "./settlement.js";

export interface Sidecar {
  app: Hono;
  config: SidecarConfig;
  registry: InMemorySourceRegistry;
  payees: PayeeRegistry;
  royaltyLegStore: RoyaltyLegStore;
  settlementProvider: SettlementProvider;
  ingestor: RssCitationIngestor;
  /** Local x402 settler for demos/tests; real agents settle on-chain. */
  demoSettler: Settler;
}

export interface SidecarOptions {
  /** Inject a settlement provider (Gateway/Circle in prod; defaults to local). */
  settlementProvider?: SettlementProvider;
  /** Override the x402 verifier (defaults to on-chain when an indexer URL is
   * configured, else a local pair for demos/tests). */
  verify?: PaymentVerifier;
}

export function createSidecar(
  config: SidecarConfig = loadConfig(),
  options: SidecarOptions = {},
): Sidecar {
  const registry = new InMemorySourceRegistry();
  const payees = new InMemoryPayeeRegistry();
  const royaltyLegStore = new InMemoryRoyaltyLegStore();
  const settlementProvider = options.settlementProvider ?? new LocalSettlementProvider();
  const ingestor = createRssIngestor({ registry, payees, config });

  // x402 verification: on-chain via the Arc indexer when configured, else a
  // local settlement pair for demos/tests.
  const localSettlement = createLocalSettlement();
  const verify: PaymentVerifier =
    options.verify ??
    (config.indexerUrl !== undefined
      ? createOnchainVerifier({ indexer: createFetchIndexerClient({ baseUrl: config.indexerUrl }) })
      : localSettlement.verify);

  const distributor = createTollDistributor({ royaltyLegStore });
  const tollRouter = createCitationTollRouter(registry, { verify, distributor });

  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      data: {
        service: "rsshub-citation-toll",
        sources: registry.all().length,
        verification: config.indexerUrl !== undefined ? "onchain" : "local-demo",
      },
    }),
  );
  app.get("/health", (c) => c.json({ data: { status: "ok" } }));

  // Admin: ingest RSS items as priced, citeable sources.
  app.post("/admin/feeds", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { items?: RssItem[] } | null;
    if (body === null || !Array.isArray(body.items)) {
      return c.json({ error: "items[] required" }, 400);
    }
    const sources = await ingestor.ingestMany(body.items);
    return c.json({ data: { ingested: sources.length, sourceIds: sources.map((s) => s.id) } });
  });

  // x402-gated citation content: GET /articles/:id returns a 402 until paid.
  app.all("/articles/:id", (c) => tollRouter(c.req.raw));

  // Admin: sweep pending royalties into author payouts (the settlement worker
  // does this on a schedule in production; exposed here so the full flow is
  // demonstrable end to end).
  app.post("/admin/sweep", async (c) => {
    const result = await sweepPendingRoyalties(royaltyLegStore, settlementProvider);
    return c.json({ data: result });
  });

  return {
    app,
    config,
    registry,
    payees,
    royaltyLegStore,
    settlementProvider,
    ingestor,
    demoSettler: localSettlement.settler,
  };
}

export function startSidecar(): void {
  const config = loadConfig();
  const sidecar = createSidecar(config, {
    settlementProvider: settlementProviderFromEnv(process.env),
  });
  serve({ fetch: sidecar.app.fetch, port: config.port });
  process.stdout.write(`rsshub-citation-toll listening on :${config.port}\n`);
}
