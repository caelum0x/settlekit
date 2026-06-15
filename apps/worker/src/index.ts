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

  const runtime = buildRuntime({ config, githubApi, discordApi, logger });

  const shutdown = runtime.scheduler.installSignalHandlers();
  runtime.scheduler.start();
  logger.info("worker started", { jobs: runtime.scheduler ? 5 : 0 });

  await shutdown;
  logger.info("worker exited cleanly");
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ level: "error", msg: "worker crashed", error: errorMessage(error) })}\n`);
  process.exitCode = 1;
});
