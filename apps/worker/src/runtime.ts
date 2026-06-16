/**
 * Runtime assembly: turn a {@link WorkerConfig} plus the external transports into
 * a fully-wired {@link JobContext} and a {@link Scheduler} ready to start.
 *
 * The GitHub/Discord transports and the Arc RPC are injectable so the same
 * assembly path is exercised by the wiring test (with in-memory doubles) and by
 * production boot (with real Octokit / fetch / viem clients). This keeps the
 * production code path and the tested code path identical.
 */

import { createArcClient, type ArcClient, type ArcRpc } from "@settlekit/arc";
import { createDefaultRegistry, DeliveryRunner } from "@settlekit/delivery";
import type { GitHubApi } from "@settlekit/github";
import type { DiscordApi } from "@settlekit/discord";
import type { HttpSender } from "@settlekit/webhooks";
import { createEmailClient, type EmailTransport } from "@settlekit/notifications";
import type { WorkerConfig } from "./config.js";
import { createDb } from "@settlekit/database";
import { InMemoryWorkerStore, type WorkerStore } from "./stores.js";
import { PgWorkerStore } from "./db/pg-worker-store.js";
import { PgLicenseStore, PgApiKeyStore, PgGrantStore, PgPayoutStore } from "@settlekit/persistence";
import { InMemoryPayoutStore, type PayoutStore } from "@settlekit/payouts";
import { createWalletsClient, type WalletsClient } from "@settlekit/circle-wallets";
import { createLogger, type Logger } from "./logger.js";
import { createDeliveryClients } from "./wiring/delivery-clients.js";
import { Scheduler, type ScheduledJob } from "./scheduler.js";
import {
  deliveryRunnerJob,
  paymentConfirmJob,
  accessSyncJob,
  renewalSweepJob,
  webhookRetryJob,
  receiptEmailJob,
  renewalReminderJob,
  dunningEmailJob,
  accessGrantedEmailJob,
  payoutReconcileJob,
  type JobContext,
} from "./jobs/index.js";

/** External integrations injected into the runtime. */
export interface RuntimeDeps {
  config: WorkerConfig;
  githubApi: GitHubApi;
  discordApi: DiscordApi;
  /** Pre-built stores (defaults to a fresh in-memory layer). */
  stores?: WorkerStore;
  /** Override the Arc RPC transport (tests inject canned receipts). */
  arcRpc?: ArcRpc;
  /** Override the email transport (tests inject an in-memory transport). */
  emailTransport?: EmailTransport;
  /** Override the outbound webhook HTTP sender (tests inject an in-memory one). */
  webhookSender?: HttpSender;
  /** Override the logger. */
  logger?: Logger;
  /** Override the payout store (defaults to Pg/in-memory like the API). */
  payoutStore?: PayoutStore;
  /** Override the Circle wallets client (tests inject an in-memory double). */
  walletsClient?: WalletsClient | null;
  /** Override the clock (deterministic tests). */
  now?: () => Date;
}

/** A fully-assembled runtime: the job context plus its scheduler. */
export interface WorkerRuntime {
  ctx: JobContext;
  stores: WorkerStore;
  arc: ArcClient;
  scheduler: Scheduler;
  logger: Logger;
}

/** Build the {@link JobContext} (without a scheduler). Useful for tests. */
export function buildJobContext(deps: RuntimeDeps): { ctx: JobContext; stores: WorkerStore; arc: ArcClient; logger: Logger } {
  // Postgres-backed shared store when DATABASE_URL is configured (and no store
  // was injected); the process-local in-memory store otherwise. The same db
  // handle backs the delivery stores so worker-issued license/API keys/file
  // grants persist to the tables the API reads.
  const db = !deps.stores && deps.config.database ? createDb(deps.config.database.url) : null;
  const stores = deps.stores ?? (db ? new PgWorkerStore(db) : new InMemoryWorkerStore());
  const logger = deps.logger ?? createLogger({ app: "worker" });
  const now = deps.now ?? (() => new Date());

  const arc: ArcClient = createArcClient(
    {
      rpcUrl: deps.config.arc.rpcUrl,
      usdcAddress: deps.config.arc.usdcAddress,
      chainId: deps.config.arc.chainId,
    },
    deps.arcRpc,
  );

  const clients = createDeliveryClients({
    config: deps.config,
    stores,
    githubApi: deps.githubApi,
    discordApi: deps.discordApi,
    webhookSigningSecret: deps.config.webhookSigningSecret,
    ...(db
      ? {
          licenseStore: new PgLicenseStore(db),
          apiKeyStore: new PgApiKeyStore(db),
          fileGrantStore: new PgGrantStore(db),
        }
      : {}),
    ...(deps.emailTransport ? { emailTransport: deps.emailTransport } : {}),
    ...(deps.webhookSender ? { webhookSender: deps.webhookSender } : {}),
  });

  const runner = new DeliveryRunner(createDefaultRegistry(), {
    logger: {
      log: (entry) => logger.debug("delivery", { ...entry }),
    },
    now,
  });

  // Real transactional-email client. Production builds a Resend-backed transport
  // from the configured API key; tests inject an in-memory transport so nothing
  // requires live network at construction.
  const email = createEmailClient({
    from: deps.config.email.from,
    ...(deps.emailTransport ? { transport: deps.emailTransport } : { apiKey: deps.config.email.apiKey }),
  });

  // Payout reconciliation: the same Postgres-backed payout store the API writes
  // to (or in-memory), plus a Circle wallets client when configured.
  const payoutStore: PayoutStore =
    deps.payoutStore ?? (db ? new PgPayoutStore(db) : new InMemoryPayoutStore());
  const walletsClient: WalletsClient | null =
    deps.walletsClient !== undefined
      ? deps.walletsClient
      : deps.config.circleWallets
        ? createWalletsClient({
            apiKey: deps.config.circleWallets.apiKey,
            ...(deps.config.circleWallets.baseUrl
              ? { baseUrl: deps.config.circleWallets.baseUrl }
              : {}),
            ...(deps.config.circleWallets.entitySecretCiphertext
              ? {
                  entitySecretProvider: () =>
                    deps.config.circleWallets!.entitySecretCiphertext!,
                }
              : {}),
          })
        : null;

  const ctx: JobContext = {
    config: deps.config,
    stores,
    logger,
    runner,
    clients,
    arc,
    email,
    githubApi: deps.githubApi,
    discordApi: deps.discordApi,
    payoutStore,
    walletsClient,
    now,
  };

  return { ctx, stores, arc, logger };
}

/** Build the full runtime including the configured scheduler. */
export function buildRuntime(deps: RuntimeDeps): WorkerRuntime {
  const { ctx, stores, arc, logger } = buildJobContext(deps);
  const intervals = deps.config.intervals;
  const scheduled: ScheduledJob[] = [
    { job: deliveryRunnerJob, intervalMs: intervals.deliveryRunnerMs },
    { job: paymentConfirmJob, intervalMs: intervals.paymentConfirmMs },
    { job: accessSyncJob, intervalMs: intervals.accessSyncMs },
    { job: renewalSweepJob, intervalMs: intervals.renewalSweepMs },
    { job: webhookRetryJob, intervalMs: intervals.webhookRetryMs },
    { job: receiptEmailJob, intervalMs: intervals.receiptEmailMs },
    { job: renewalReminderJob, intervalMs: intervals.renewalReminderMs },
    { job: dunningEmailJob, intervalMs: intervals.dunningEmailMs },
    { job: accessGrantedEmailJob, intervalMs: intervals.accessEmailMs },
    { job: payoutReconcileJob, intervalMs: intervals.payoutReconcileMs },
  ];

  const scheduler = new Scheduler(scheduled, ctx, logger);
  return { ctx, stores, arc, scheduler, logger };
}
