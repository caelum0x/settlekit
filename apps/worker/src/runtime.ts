/**
 * Runtime assembly: turn a {@link WorkerConfig} plus the external transports into
 * a fully-wired {@link JobContext} and a {@link Scheduler} ready to start.
 *
 * The GitHub/Discord transports and the Arc RPC are injectable so the same
 * assembly path is exercised by the wiring test (with in-memory doubles) and by
 * production boot (with real Octokit / fetch / viem clients). This keeps the
 * production code path and the tested code path identical.
 */

import { createArcClient, type ArcClient, type ArcRpc, type FullEvmRpc } from "@settlekit/arc";
import { createChainRpc, createEvmVerifier, type EvmChainKey, type EvmVerifier } from "@settlekit/chains";
import { createBlockchairExplorer, type FetchLike, type ZcashExplorer } from "@settlekit/zcash";
import { createHyperCoreClient, type HyperliquidTransport } from "@settlekit/hyperliquid";
import { createRouterFromConfig, type FetchLike as RouteFetch } from "@settlekit/routing";
import { createKitSolanaRpc, type SolanaRpc } from "@settlekit/solana";
import { createDefaultRegistry, DeliveryRunner } from "@settlekit/delivery";
import type { GitHubApi } from "@settlekit/github";
import type { DiscordApi } from "@settlekit/discord";
import type { HttpSender } from "@settlekit/webhooks";
import { createEmailClient, type EmailTransport } from "@settlekit/notifications";
import type { WorkerConfig } from "./config.js";
import { createDb, type Database } from "@settlekit/database";
import { InMemoryWorkerStore, type WorkerStore } from "./stores.js";
import { PgWorkerStore } from "./db/pg-worker-store.js";
import {
  PgLicenseStore,
  PgApiKeyStore,
  PgGrantStore,
  PgPayoutStore,
  PgIdempotencyStore,
  PgRoyaltyLegStore,
  PgStreamStore,
  PgWebhookOutbox,
} from "@settlekit/persistence";
import { InMemoryPayoutStore, type PayoutStore } from "@settlekit/payouts";
import type {
  ConfirmationSource,
  SettlementProvider,
  SettlementReceiptStore,
} from "@settlekit/settlement-core";
import type { RoyaltyLegStore } from "@settlekit/citation-toll";
import type { StreamStore } from "@settlekit/streaming";
import type { OnchainBillingRuntime } from "@settlekit/onchain-billing";
import { createWalletsClient, type WalletsClient } from "@settlekit/circle-wallets";
import { createLogger, type Logger } from "./logger.js";
import { createArcSettlementProvider } from "./settlement/arc-provider.js";
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
  leptonSettlementReconcileJob,
  leptonPayoutSweepJob,
  leptonStreamRefundJob,
  zcashWatchJob,
  routeWatchJob,
  githubDeliveryRetryJob,
  subscriptionChargeJob,
  type JobContext,
} from "./jobs/index.js";

/** External integrations injected into the runtime. */
export interface RuntimeDeps {
  config: WorkerConfig;
  githubApi: GitHubApi;
  discordApi: DiscordApi;
  /** Shared database handle (boot passes the one its stores already use). */
  db?: Database | null;
  /** Pre-built stores (defaults to a fresh in-memory layer). */
  stores?: WorkerStore;
  /** Override the Arc RPC transport (tests inject canned receipts). */
  arcRpc?: ArcRpc;
  /** Override the Solana RPC transport (tests inject canned transactions). */
  solanaRpc?: SolanaRpc;
  /** Override EVM RPCs per chain (tests inject canned receipts). */
  evmRpcs?: Partial<Record<EvmChainKey, FullEvmRpc>>;
  /** Override the Zcash explorer (tests inject recorded responses). */
  zcashExplorer?: ZcashExplorer;
  /** Override the Hyperliquid transport (tests inject recorded ledgers). */
  hypercoreTransport?: HyperliquidTransport;
  /** Override fetch for Relay / LI.FI (tests replay recorded responses). */
  routingFetch?: RouteFetch;
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
  /** Override the settlement receipt store (defaults to Pg when a DB is set). */
  settlementStore?: SettlementReceiptStore;
  /** On-chain confirmation source for settlement reconciliation (Arc indexer). */
  confirmationSource?: ConfirmationSource;
  /** Settlement provider for royalty payouts / stream refunds (Gateway/Circle). */
  settlementProvider?: SettlementProvider;
  /** Override the royalty-leg store (defaults to Pg when a DB is set). */
  royaltyLegStore?: RoyaltyLegStore;
  /** Override the stream store (defaults to Pg when a DB is set). */
  streamStore?: StreamStore;
  /** Onchain billing runtime (built async by buildWorkerOnchainBilling). */
  onchainBilling?: OnchainBillingRuntime | null;
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
  const db = deps.db ?? (!deps.stores && deps.config.database ? createDb(deps.config.database.url) : null);
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

  // Solana payment verification, only when a cluster is configured.
  const solana = deps.config.solana
    ? {
        rpc: deps.solanaRpc ?? createKitSolanaRpc(deps.config.solana.rpcUrl),
        usdcMint: deps.config.solana.usdcMint,
      }
    : undefined;

  const evm = buildEvmVerifiers(deps);
  const zcash = deps.config.zcash
    ? {
        explorer:
          deps.zcashExplorer ??
          createBlockchairExplorer({
            fetch: globalThis.fetch as FetchLike,
            baseUrl: deps.config.zcash.explorerUrl,
            ...(deps.config.zcash.apiKey ? { apiKey: deps.config.zcash.apiKey } : {}),
          }),
        minConfirmations: deps.config.zcash.minConfirmations,
      }
    : undefined;

  const hypercore = deps.config.hypercore
    ? createHyperCoreClient(deps.config.hypercore, deps.hypercoreTransport ? { transport: deps.hypercoreTransport } : {})
    : undefined;
  const router = deps.config.routing ? createRouterFromConfig(deps.config.routing, deps.routingFetch) : undefined;

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

  // Settlement provider resolution (mirrors the walletsClient block above):
  //  - an explicitly injected provider wins (tests);
  //  - else, when SETTLEMENT_PROVIDER=arc, build the live viem-backed provider —
  //    but if arcSettlement could not be assembled (missing ARC_SETTLER_PRIVATE_KEY),
  //    warn and fall back to local (undefined → jobs no-op);
  //  - else (the default), leave it undefined so behavior is unchanged.
  let settlementProvider: SettlementProvider | undefined;
  if (deps.settlementProvider !== undefined) {
    settlementProvider = deps.settlementProvider;
  } else if (deps.config.settlementProvider === "arc") {
    if (deps.config.arcSettlement === null) {
      logger.warn("SETTLEMENT_PROVIDER=arc but no signer configured; falling back to local", {
        reason: "missing ARC_SETTLER_PRIVATE_KEY",
      });
      settlementProvider = undefined;
    } else {
      // createArcSettlementProvider already warns and returns null on failure.
      settlementProvider = createArcSettlementProvider(deps.config.arcSettlement, logger) ?? undefined;
    }
  }

  // Settlement spine: Pg-backed stores when a DB is configured; the confirmation
  // source and settlement provider are injected by the deployment (they need an
  // Arc indexer URL and signer/wallet config), so the Lepton jobs no-op until set.
  const settlementStore: SettlementReceiptStore | undefined =
    deps.settlementStore ?? (db ? new PgIdempotencyStore(db) : undefined);
  const royaltyLegStore: RoyaltyLegStore | undefined =
    deps.royaltyLegStore ?? (db ? new PgRoyaltyLegStore(db) : undefined);
  const streamStore: StreamStore | undefined =
    deps.streamStore ?? (db ? new PgStreamStore(db) : undefined);

  const ctx: JobContext = {
    config: deps.config,
    stores,
    logger,
    runner,
    clients,
    arc,
    ...(solana !== undefined ? { solana } : {}),
    evm,
    ...(zcash !== undefined ? { zcash } : {}),
    ...(hypercore !== undefined ? { hypercore } : {}),
    ...(router !== undefined ? { router } : {}),
    email,
    githubApi: deps.githubApi,
    discordApi: deps.discordApi,
    payoutStore,
    walletsClient,
    ...(settlementStore !== undefined ? { settlementStore } : {}),
    ...(deps.confirmationSource !== undefined ? { confirmationSource: deps.confirmationSource } : {}),
    ...(settlementProvider !== undefined ? { settlementProvider } : {}),
    ...(royaltyLegStore !== undefined ? { royaltyLegStore } : {}),
    ...(streamStore !== undefined ? { streamStore } : {}),
    ...(deps.onchainBilling ? { onchainBilling: deps.onchainBilling } : {}),
    ...(db ? { webhooks: new PgWebhookOutbox(db) } : {}),
    now,
  };

  return { ctx, stores, arc, logger };
}

function isFullEvmRpc(rpc: ArcRpc | undefined): rpc is FullEvmRpc {
  return rpc !== undefined && rpc.getChainId !== undefined && rpc.getBlockTimestamp !== undefined;
}

/**
 * One verifier per enabled EVM chain. Arc payments move onto the same path;
 * an injected `arcRpc` that implements the full EvmRpc also backs Arc here.
 */
function buildEvmVerifiers(deps: RuntimeDeps): Partial<Record<EvmChainKey, EvmVerifier>> {
  const verifiers: Partial<Record<EvmChainKey, EvmVerifier>> = {};
  for (const chain of Object.values(deps.config.evm.enabled)) {
    if (chain === undefined) continue;
    const injected = deps.evmRpcs?.[chain.key] ?? (chain.key === "arc" && isFullEvmRpc(deps.arcRpc) ? deps.arcRpc : undefined);
    verifiers[chain.key] = createEvmVerifier({
      spec: chain.spec,
      rpc: injected ?? createChainRpc(chain.spec, chain.rpcUrl),
      minConfirmations: chain.minConfirmations,
      tokenAddress: chain.tokenAddress,
    });
  }
  return verifiers;
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
    // Reuse the payout-reconcile cadence; all no-op until the settlement spine is wired.
    { job: leptonSettlementReconcileJob, intervalMs: intervals.payoutReconcileMs },
    { job: leptonPayoutSweepJob, intervalMs: intervals.payoutReconcileMs },
    { job: leptonStreamRefundJob, intervalMs: intervals.payoutReconcileMs },
    // No-op (no network calls) unless Zcash is enabled AND open Zcash sessions exist.
    { job: zcashWatchJob, intervalMs: intervals.zcashWatchMs },
    // No-op (no network calls) unless routing is enabled AND sessions have routes in flight.
    { job: routeWatchJob, intervalMs: intervals.routeWatchMs },
    // No-op until a GitHub App installation id is configured.
    { job: githubDeliveryRetryJob, intervalMs: intervals.githubDeliveryRetryMs },
    // No-op until onchain billing is configured (operator key / checkout URL).
    { job: subscriptionChargeJob, intervalMs: intervals.subscriptionChargeMs },
  ];

  const scheduler = new Scheduler(scheduled, ctx, logger);
  return { ctx, stores, arc, scheduler, logger };
}
