/**
 * Assemble the Navidrome per-listen scrobble sidecar: accept play events, accrue
 * per-listen royalties to artists (play-gated, per-user capped), and settle them
 * to artist wallets through the production settlement spine.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  InMemoryRoyaltyLegStore,
  type RoyaltyLegStore,
  sweepPendingRoyalties,
} from "@settlekit/citation-toll";
import { InMemoryPayeeRegistry, type PayeeRegistry } from "@settlekit/payee-registry";
import { LocalSettlementProvider, type SettlementProvider } from "@settlekit/settlement-core";
import { SpendingCapEnforcer } from "@settlekit/wallet-fleet";
import { type NavidromeConfig, loadConfig } from "./config.js";
import { type ScrobbleEvent, type ScrobbleProcessor, createScrobbleProcessor } from "./scrobble.js";

export interface NavidromeSidecar {
  app: Hono;
  config: NavidromeConfig;
  payees: PayeeRegistry;
  royaltyLegStore: RoyaltyLegStore;
  settlementProvider: SettlementProvider;
  processor: ScrobbleProcessor;
}

export interface NavidromeOptions {
  /** Inject a settlement provider (Gateway/Circle in prod; defaults to local). */
  settlementProvider?: SettlementProvider;
}

export function createSidecar(
  config: NavidromeConfig = loadConfig(),
  options: NavidromeOptions = {},
): NavidromeSidecar {
  const payees = new InMemoryPayeeRegistry();
  const royaltyLegStore = new InMemoryRoyaltyLegStore();
  const settlementProvider = options.settlementProvider ?? new LocalSettlementProvider();
  const caps = new SpendingCapEnforcer();
  const processor = createScrobbleProcessor({ payees, royaltyLegStore, caps, config });

  const app = new Hono();

  app.get("/", async (c) =>
    c.json({
      data: {
        service: "navidrome-scrobble",
        perListenUsdc: config.perListenUsdc,
        minPlaySeconds: config.minPlaySeconds,
        pendingLegs: (await royaltyLegStore.listPending()).length,
      },
    }),
  );
  app.get("/health", (c) => c.json({ data: { status: "ok" } }));

  // Register an artist's payout wallet.
  app.post("/admin/artists", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { externalId?: string; wallet?: string; displayName?: string }
      | null;
    if (body === null || !body.externalId || !body.wallet) {
      return c.json({ error: "externalId and wallet required" }, 400);
    }
    const payee = await payees.register({
      kind: "musicbrainz",
      externalId: body.externalId,
      wallet: body.wallet,
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    });
    return c.json({ data: payee });
  });

  // Ingest a play event (a Subsonic/Navidrome scrobble).
  app.post("/scrobble", async (c) => {
    const body = (await c.req.json().catch(() => null)) as ScrobbleEvent | null;
    if (
      body === null ||
      typeof body.userId !== "string" ||
      typeof body.trackId !== "string" ||
      typeof body.playedSeconds !== "number" ||
      typeof body.artist?.externalId !== "string"
    ) {
      return c.json({ error: "invalid scrobble event" }, 400);
    }
    const result = await processor.process(body);
    return c.json({ data: result });
  });

  // Settle accrued per-listen royalties to artists.
  app.post("/admin/sweep", async (c) => {
    const result = await sweepPendingRoyalties(royaltyLegStore, settlementProvider);
    return c.json({ data: result });
  });

  return { app, config, payees, royaltyLegStore, settlementProvider, processor };
}

export function startSidecar(): void {
  const config = loadConfig();
  const sidecar = createSidecar(config);
  serve({ fetch: sidecar.app.fetch, port: config.port });
  process.stdout.write(`navidrome-scrobble listening on :${config.port}\n`);
}
