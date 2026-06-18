/**
 * Assemble the Owncast per-second streaming sidecar: meter viewer sessions and
 * settle watched time to streamers through the production settlement spine.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  InMemoryRoyaltyLegStore,
  type RoyaltyLegStore,
  sweepPendingRoyalties,
} from "@settlekit/citation-toll";
import { InMemoryPayeeRegistry, type PayeeRegistry } from "@settlekit/payee-registry";
import {
  LocalSettlementProvider,
  type SettlementProvider,
  settlementProviderFromEnv,
} from "@settlekit/settlement-core";
import { type OwncastConfig, loadConfig } from "./config.js";
import { type JoinEvent, type OwncastSessions, createOwncastSessions } from "./sessions.js";

export interface OwncastSidecar {
  app: Hono;
  config: OwncastConfig;
  payees: PayeeRegistry;
  royaltyLegStore: RoyaltyLegStore;
  settlementProvider: SettlementProvider;
  sessions: OwncastSessions;
}

export interface OwncastOptions {
  /** Inject a settlement provider (Gateway/Circle in prod; defaults to local). */
  settlementProvider?: SettlementProvider;
  /** Epoch-ms clock for deterministic tests. */
  now?: () => number;
}

export function createSidecar(
  config: OwncastConfig = loadConfig(),
  options: OwncastOptions = {},
): OwncastSidecar {
  const payees = new InMemoryPayeeRegistry();
  const royaltyLegStore = new InMemoryRoyaltyLegStore();
  const settlementProvider = options.settlementProvider ?? new LocalSettlementProvider();
  const sessions = createOwncastSessions({
    payees,
    royaltyLegStore,
    config,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      data: {
        service: "owncast-stream",
        perSecondUsdc: config.perSecondUsdc,
        reserveUsdc: config.reserveUsdc,
        activeSessions: sessions.active(),
      },
    }),
  );
  app.get("/health", (c) => c.json({ data: { status: "ok" } }));

  // A viewer started watching.
  app.post("/sessions/join", async (c) => {
    const body = (await c.req.json().catch(() => null)) as JoinEvent | null;
    if (body === null || typeof body.sessionId !== "string" || typeof body.streamer?.externalId !== "string") {
      return c.json({ error: "sessionId and streamer.externalId required" }, 400);
    }
    const opened = await sessions.join(body);
    return c.json({ data: { metering: opened } }, opened ? 200 : 422);
  });

  // A viewer stopped watching — settle the time they were present.
  app.post("/sessions/leave", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { sessionId?: string } | null;
    if (body === null || typeof body.sessionId !== "string") {
      return c.json({ error: "sessionId required" }, 400);
    }
    const result = await sessions.leave(body.sessionId);
    if (result === undefined) {
      return c.json({ error: "unknown session" }, 404);
    }
    return c.json({ data: result });
  });

  // Settle accrued streamer royalties.
  app.post("/admin/sweep", async (c) => {
    const result = await sweepPendingRoyalties(royaltyLegStore, settlementProvider);
    return c.json({ data: result });
  });

  return { app, config, payees, royaltyLegStore, settlementProvider, sessions };
}

export function startSidecar(): void {
  const config = loadConfig();
  const sidecar = createSidecar(config, {
    settlementProvider: settlementProviderFromEnv(process.env),
  });
  serve({ fetch: sidecar.app.fetch, port: config.port });
  process.stdout.write(`owncast-stream listening on :${config.port}\n`);
}
