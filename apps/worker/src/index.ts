/**
 * SettleKit background worker entrypoint (plan §17).
 *
 * Boots the runtime with REAL transports — an Octokit-backed GitHub App client,
 * a fetch-backed Discord client, a viem-backed Arc settlement client, and the
 * Resend email transport — then starts the scheduler. SIGINT/SIGTERM trigger a
 * graceful drain so in-flight delivery/sync ticks complete before exit.
 */

import { OctokitGitHubApi, type GitHubApi } from "@settlekit/github";
import type { EmailTransport } from "@settlekit/notifications";
import { createDiscordClient, type DiscordApi } from "@settlekit/discord";

/** An API whose every method rejects with `reason` (integration not configured). */
function unconfigured<T extends object>(reason: string): T {
  return new Proxy({} as T, {
    get: () => async () => {
      throw new Error(reason);
    },
  });
}

function unconfiguredDiscordApi(): DiscordApi {
  const fail = async (): Promise<never> => {
    throw new Error("Discord bot is not configured (DISCORD_BOT_TOKEN)");
  };
  return { listGuilds: fail, listGuildRoles: fail, addRole: fail, removeRole: fail };
}
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

  // Real GitHub App transport, authenticated as the configured installation;
  // without GITHUB_APP_PRIVATE_KEY every GitHub call reports "not configured".
  const githubApi: GitHubApi = config.github.privateKey
    ? OctokitGitHubApi.fromAppCredentials({
        appId: config.github.appId,
        privateKey: config.github.privateKey,
        installationId: config.github.installationId,
      })
    : unconfigured<GitHubApi>("GitHub App is not configured (GITHUB_APP_PRIVATE_KEY)");

  // Resend transport; without RESEND_API_KEY every send fails with a clear reason (jobs log and continue).
  const emailTransport: EmailTransport | undefined = config.email.apiKey
    ? undefined
    : { send: async () => { throw new Error("Email is not configured (RESEND_API_KEY)"); } };
  if (!config.email.apiKey) logger.warn("RESEND_API_KEY is not set: buyer emails are skipped", {});
  if (!config.github.privateKey) logger.warn("GITHUB_APP_PRIVATE_KEY is not set: GitHub deliveries stay pending", {});
  if (!config.discord.configured) logger.warn("DISCORD_BOT_TOKEN is not set: Discord roles stay pending", {});

  // Real fetch-backed Discord bot transport; without a bot token every call
  // fails with "pending setup" and Discord entitlements stay pending until set.
  const discordApi: DiscordApi = config.discord.configured
    ? createDiscordClient({ botToken: config.discord.botToken, auditReason: "SettleKit access automation" })
    : unconfiguredDiscordApi();

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
    email: createEmailClient({ from: config.email.from, ...(emailTransport ? { transport: emailTransport } : { apiKey: config.email.apiKey }) }),
    logger,
  });

  const runtime = buildRuntime({
    config,
    githubApi,
    discordApi,
    logger,
    db,
    stores,
    onchainBilling,
    ...(emailTransport ? { emailTransport } : {}),
  });

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
