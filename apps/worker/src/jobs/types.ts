/**
 * Shared shape for every scheduled job plus the runtime context they receive.
 *
 * A job is a named async unit of work the scheduler invokes on an interval. It
 * returns a small {@link JobResult} so the scheduler can log throughput without
 * the job needing to know how it is scheduled.
 */

import type { DeliveryRunner } from "@settlekit/delivery";
import type { ArcClient } from "@settlekit/arc";
import type { DeliveryClients } from "@settlekit/delivery";
import type { GitHubApi } from "@settlekit/github";
import type { DiscordApi } from "@settlekit/discord";
import type { EmailClient } from "@settlekit/notifications";
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
   * Real transactional-email client (Resend-backed in prod, in-memory transport
   * in tests). Used directly by the customer-communication jobs that render and
   * send receipts, renewal reminders, dunning, and access-granted emails.
   */
  email: EmailClient;
  /** Raw GitHub transport for access reconciliation (not just delivery). */
  githubApi: GitHubApi;
  /** Raw Discord transport for access reconciliation (not just delivery). */
  discordApi: DiscordApi;
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
