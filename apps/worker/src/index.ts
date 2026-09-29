/**
 * SettleKit background worker entrypoint (plan §17).
 *
 * Boots the runtime with REAL transports — an Octokit-backed GitHub App client,
 * a fetch-backed Discord client, a viem-backed Arc settlement client, and the
 * Resend email transport — then starts the scheduler. SIGINT/SIGTERM trigger a
 * graceful drain so in-flight delivery/sync ticks complete before exit.
 */

import { OctokitGitHubApi } from "@settlekit/github";
import { createDiscordClient } from "@settlekit/discord";
import { loadConfig, ConfigError } from "./config.js";
import { buildRuntime } from "./runtime.js";
import { startHealthServer } from "./health-server.js";
import { createLogger, errorMessage } from "./logger.js";

async function main(): Promise<void> {
  const logger = createLogger({ app: "worker" });

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error("invalid worker configuration", { error: error.message });
      process.exitCode = 78; // EX_CONFIG
      return;
    }
    throw error;
  }

  // Real GitHub App transport, authenticated as the configured installation.
  const githubApi = OctokitGitHubApi.fromAppCredentials({
    appId: config.github.appId,
    privateKey: config.github.privateKey,
    installationId: config.github.installationId,
  });

  // Real fetch-backed Discord bot transport.
  const discordApi = createDiscordClient({
    botToken: config.discord.botToken,
    auditReason: "SettleKit access automation",
  });

  // In Postgres mode, ensure the default org/merchant exist before jobs run so
  // payment/subscription/entitlement upserts never violate the merchant FK.
  if (config.database) {
    const { createDb } = await import("@settlekit/database");
    const { ensureWorkerDefaults } = await import("./db/pg-worker-store.js");
    await ensureWorkerDefaults(createDb(config.database.url));
    logger.info("worker persistence: postgres", {});
  } else {
    logger.info("worker persistence: in-memory", {});
  }

  // Onchain subscriptions (Permit2 / spend permission / SPL delegate pulls,
  // renewal invoices): built async, before the scheduler, on the same stores.
  const { createDb } = await import("@settlekit/database");
  const { createEmailClient } = await import("@settlekit/notifications");
  const { buildWorkerOnchainBilling } = await import("./wiring/onchain-billing.js");
  const { PgWorkerStore } = await import("./db/pg-worker-store.js");
  const { InMemoryWorkerStore } = await import("./stores.js");
  const db = config.database ? createDb(config.database.url) : null;
  const stores = db ? new PgWorkerStore(db) : new InMemoryWorkerStore();
  const onchainBilling = await buildWorkerOnchainBilling({
    env: process.env,
    stores,
    db,
    email: createEmailClient({ from: config.email.from, apiKey: config.email.apiKey }),
    logger,
  });

  const runtime = buildRuntime({ config, githubApi, discordApi, logger, db, stores, onchainBilling });

  const shutdown = runtime.scheduler.installSignalHandlers();
  runtime.scheduler.start();
  // Liveness/readiness/metrics endpoint for production orchestrators.
  const healthServer = startHealthServer(runtime.scheduler, logger);
  logger.info("worker started", { jobs: 9 });

  await shutdown;
  healthServer.close();
  logger.info("worker exited cleanly");
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ level: "error", msg: "worker crashed", error: errorMessage(error) })}\n`);
  process.exitCode = 1;
});
