/**
 * Shared shape for every scheduled job plus the runtime context they receive.
 *
 * A job is a named async unit of work the scheduler invokes on an interval. It
 * returns a small {@link JobResult} so the scheduler can log throughput without
 * the job needing to know how it is scheduled.
 */

import type { DeliveryRunner } from "@settlekit/delivery";
import type { ArcClient } from "@settlekit/arc";
import type { SolanaRpc } from "@settlekit/solana";
import type { EvmChainKey, EvmVerifier } from "@settlekit/chains";
import type { ZcashExplorer } from "@settlekit/zcash";
import type { HyperCoreLedgerSource } from "@settlekit/hyperliquid";
import type { Router } from "@settlekit/routing";
import type { DeliveryClients } from "@settlekit/delivery";
import type { GitHubApi } from "@settlekit/github";
import type { DiscordApi } from "@settlekit/discord";
import type { EmailClient } from "@settlekit/notifications";
import type { PayoutStore } from "@settlekit/payouts";
import type { WalletsClient } from "@settlekit/circle-wallets";
import type {
  ConfirmationSource,
  SettlementProvider,
  SettlementReceiptStore,
} from "@settlekit/settlement-core";
import type { RoyaltyLegStore } from "@settlekit/citation-toll";
import type { StreamStore } from "@settlekit/streaming";
import type { OnchainBillingRuntime } from "@settlekit/onchain-billing";
import type { WorkerConfig } from "../config.js";
import type { WorkerStore } from "../stores.js";
import type { Logger } from "../logger.js";

/** Everything a job needs to do real work, assembled once at boot. */
export interface JobContext {
  config: WorkerConfig;
  stores: WorkerStore;
  logger: Logger;
  runner: DeliveryRunner;
  clients: DeliveryClients;
  arc: ArcClient;
  /**
   * Solana USDC reader for confirming Solana payments; absent when
   * SOLANA_CLUSTER is unset (Solana payments then stay pending — fail closed).
   */
  solana?: { rpc: SolanaRpc; usdcMint: string };
  /**
   * Stablecoin verifiers for every ENABLED EVM chain (Arc included). A
   * payment on a chain without an entry stays pending (fail closed).
   */
  evm: Readonly<Partial<Record<EvmChainKey, EvmVerifier>>>;
  /** Transparent Zcash reader; absent unless ZCASH_ENABLED. */
  zcash?: { explorer: ZcashExplorer; minConfirmations: number };
  /** HyperCore ledger reader; absent unless HYPERCORE_ENABLED (fail closed). */
  hypercore?: HyperCoreLedgerSource;
  /** Any-token route providers; absent unless ROUTING_ENABLED (route-watch no-ops). */
  router?: Router;
  /**
   * Real transactional-email client (Resend-backed in prod, in-memory transport
   * in tests). Used directly by the customer-communication jobs that render and
   * send receipts, renewal reminders, dunning, and access-granted emails.
   */
  email: EmailClient;
  /** Raw GitHub transport for access reconciliation (not just delivery). */
  githubApi: GitHubApi;
  /** Raw Discord transport for access reconciliation (not just delivery). */
  discordApi: DiscordApi;
  /** Payout store, for reconciling executed-but-unsettled payouts. */
  payoutStore: PayoutStore;
  /** Circle wallets client for payout reconciliation; null when unconfigured. */
  walletsClient: WalletsClient | null;
  /** Settlement receipt store for the settlement-reconcile job; absent when the
   * Lepton settlement spine is not wired (the job then no-ops). */
  settlementStore?: SettlementReceiptStore;
  /** On-chain confirmation source (Arc indexer); absent → reconcile no-ops. */
  confirmationSource?: ConfirmationSource;
  /** Settlement provider for paying out royalties / stream refunds; absent →
   * the payout-sweep and stream-refund jobs no-op. */
  settlementProvider?: SettlementProvider;
  /** Pending royalty legs to sweep into author payouts. */
  royaltyLegStore?: RoyaltyLegStore;
  /** Stream records to refund reserved-but-unused balances from. */
  streamStore?: StreamStore;
  /** Onchain subscriptions + refunds; absent -> the subscription-charge job no-ops. */
  onchainBilling?: OnchainBillingRuntime;
  /** Injectable clock for deterministic tests. */
  now: () => Date;
}

/** Outcome summary of a single job tick. */
export interface JobResult {
  /** How many items the job processed this tick. */
  processed: number;
  /** How many of those resulted in a handled failure (not a thrown error). */
  failed: number;
}

/** A scheduled unit of work. */
export interface Job {
  readonly name: string;
  run(ctx: JobContext): Promise<JobResult>;
}
