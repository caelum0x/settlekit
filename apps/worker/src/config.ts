/**
 * Environment-driven configuration for the SettleKit background worker.
 *
 * All values are read once at boot and validated. Missing required secrets fail
 * fast with a precise message rather than surfacing as opaque runtime errors
 * deep inside a job. Numeric intervals are bounded so a bad env var cannot turn
 * a sweep into a tight CPU loop.
 */

import { isArcAddress, type ArcAddress } from "@settlekit/arc";

/** A single recurring job's cadence, in milliseconds. */
export interface JobIntervals {
  /** How often pending delivery runs are executed. */
  deliveryRunnerMs: number;
  /** How often pending payments are polled for on-chain confirmation. */
  paymentConfirmMs: number;
  /** How often GitHub/Discord access is reconciled and expired grants revoked. */
  accessSyncMs: number;
  /** How often subscriptions are advanced/graced/expired. */
  renewalSweepMs: number;
  /** How often failed webhooks are redelivered. */
  webhookRetryMs: number;
  /** How often confirmed payments are swept for an unsent receipt email. */
  receiptEmailMs: number;
  /** How often upcoming renewals are swept for a reminder email. */
  renewalReminderMs: number;
  /** How often grace/past-due subscriptions are swept for a dunning email. */
  dunningEmailMs: number;
  /** How often succeeded delivery runs are swept for an access-granted email. */
  accessEmailMs: number;
  /** How often executed-but-unsettled payouts are reconciled against Circle. */
  payoutReconcileMs: number;
}

/** Circle developer-controlled wallets used to reconcile executed payouts. */
export interface CircleWalletsConfig {
  apiKey: string;
  walletId: string;
  baseUrl?: string;
  entitySecretCiphertext?: string;
}

/** Arc (EVM USDC) settlement reader configuration. */
export interface ArcConfig {
  rpcUrl: string;
  usdcAddress: ArcAddress;
  chainId: number;
  /** Confirmations required before a payment is treated as settled. */
  minConfirmations: number;
}

/** Transactional email sender configuration (Resend). */
export interface EmailConfig {
  apiKey: string;
  from: string;
}

/** GitHub App credentials used to mint installation-scoped clients. */
export interface GithubConfig {
  appId: number;
  privateKey: string;
  /** Default installation id the worker authenticates as for sync/automation. */
  installationId: number;
}

/** Discord bot credentials used for role automation. */
export interface DiscordConfig {
  botToken: string;
}

/** File-delivery signed-URL configuration. */
export interface FileDeliveryConfig {
  baseUrl: string;
  secret: string;
  defaultExpiresInSec: number;
  defaultMaxDownloads: number;
}

/** License token signing configuration. */
export interface LicenseConfig {
  tokenSecret: string;
}

/** Fully-resolved worker configuration. */
export interface WorkerConfig {
  intervals: JobIntervals;
  arc: ArcConfig;
  email: EmailConfig;
  github: GithubConfig;
  discord: DiscordConfig;
  fileDelivery: FileDeliveryConfig;
  license: LicenseConfig;
  /** Circle wallets for payout reconciliation; null when unconfigured. */
  circleWallets: CircleWalletsConfig | null;
  /** Default grace window (days) applied when a renewal is missed. */
  graceDays: number;
  /** HMAC secret used to sign outbound webhooks dispatched by delivery actions. */
  webhookSigningSecret: string;
  /** Send a renewal reminder when currentPeriodEnd is within this many days. */
  renewalReminderDays: number;
  /**
   * Postgres connection. When set, the worker persists to (and reads) the shared
   * database; when unset it runs against a process-local in-memory store.
   */
  database?: { url: string };
}

/** Raised when a required environment variable is absent or malformed. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function requireString(env: Env, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim().length === 0) {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalString(env: Env, key: string, fallback: string): string {
  const value = env[key];
  return value === undefined || value.trim().length === 0 ? fallback : value;
}

function intInRange(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new ConfigError(`Environment variable ${key} must be an integer, got "${raw}"`);
  }
  if (parsed < min || parsed > max) {
    throw new ConfigError(`Environment variable ${key} must be between ${min} and ${max}, got ${parsed}`);
  }
  return parsed;
}

function requireArcAddress(env: Env, key: string): ArcAddress {
  const value = requireString(env, key);
  if (!isArcAddress(value)) {
    throw new ConfigError(`Environment variable ${key} must be a 0x-prefixed 20-byte address`);
  }
  return value;
}

/**
 * Build {@link WorkerConfig} from a process environment. Defaults to
 * `process.env` but accepts an explicit env map for tests.
 */
export function loadConfig(env: Env = process.env): WorkerConfig {
  const intervals: JobIntervals = {
    deliveryRunnerMs: intInRange(env, "WORKER_DELIVERY_INTERVAL_MS", 5_000, 250, 3_600_000),
    paymentConfirmMs: intInRange(env, "WORKER_PAYMENT_INTERVAL_MS", 10_000, 250, 3_600_000),
    accessSyncMs: intInRange(env, "WORKER_ACCESS_SYNC_INTERVAL_MS", 300_000, 1_000, 86_400_000),
    renewalSweepMs: intInRange(env, "WORKER_RENEWAL_INTERVAL_MS", 600_000, 1_000, 86_400_000),
    webhookRetryMs: intInRange(env, "WORKER_WEBHOOK_RETRY_INTERVAL_MS", 30_000, 1_000, 86_400_000),
    receiptEmailMs: intInRange(env, "WORKER_RECEIPT_EMAIL_INTERVAL_MS", 60_000, 1_000, 86_400_000),
    renewalReminderMs: intInRange(env, "WORKER_RENEWAL_REMINDER_INTERVAL_MS", 3_600_000, 1_000, 86_400_000),
    dunningEmailMs: intInRange(env, "WORKER_DUNNING_EMAIL_INTERVAL_MS", 3_600_000, 1_000, 86_400_000),
    accessEmailMs: intInRange(env, "WORKER_ACCESS_EMAIL_INTERVAL_MS", 60_000, 1_000, 86_400_000),
    payoutReconcileMs: intInRange(env, "WORKER_PAYOUT_RECONCILE_INTERVAL_MS", 60_000, 1_000, 86_400_000),
  };

  const circleWallets: CircleWalletsConfig | null =
    env.CIRCLE_WALLETS_API_KEY && env.CIRCLE_WALLETS_WALLET_ID
      ? {
          apiKey: env.CIRCLE_WALLETS_API_KEY,
          walletId: env.CIRCLE_WALLETS_WALLET_ID,
          ...(env.CIRCLE_WALLETS_BASE_URL ? { baseUrl: env.CIRCLE_WALLETS_BASE_URL } : {}),
          ...(env.CIRCLE_WALLETS_ENTITY_SECRET_CIPHERTEXT
            ? { entitySecretCiphertext: env.CIRCLE_WALLETS_ENTITY_SECRET_CIPHERTEXT }
            : {}),
        }
      : null;

  return {
    intervals,
    circleWallets,
    arc: {
      rpcUrl: requireString(env, "ARC_RPC_URL"),
      usdcAddress: requireArcAddress(env, "ARC_USDC_ADDRESS"),
      chainId: intInRange(env, "ARC_CHAIN_ID", 1, 1, 2_147_483_647),
      minConfirmations: intInRange(env, "ARC_MIN_CONFIRMATIONS", 3, 1, 1_000),
    },
    email: {
      apiKey: requireString(env, "RESEND_API_KEY"),
      from: optionalString(env, "EMAIL_FROM", "SettleKit <receipts@settlekit.dev>"),
    },
    github: {
      appId: intInRange(env, "GITHUB_APP_ID", 1, 1, 2_147_483_647),
      privateKey: requireString(env, "GITHUB_APP_PRIVATE_KEY"),
      installationId: intInRange(env, "GITHUB_INSTALLATION_ID", 1, 1, 2_147_483_647),
    },
    discord: {
      botToken: requireString(env, "DISCORD_BOT_TOKEN"),
    },
    fileDelivery: {
      baseUrl: requireString(env, "FILE_DELIVERY_BASE_URL"),
      secret: requireString(env, "FILE_DELIVERY_SECRET"),
      defaultExpiresInSec: intInRange(env, "FILE_DELIVERY_EXPIRES_SEC", 3_600, 60, 2_592_000),
      defaultMaxDownloads: intInRange(env, "FILE_DELIVERY_MAX_DOWNLOADS", 5, 1, 10_000),
    },
    license: {
      tokenSecret: requireString(env, "LICENSE_TOKEN_SECRET"),
    },
    graceDays: intInRange(env, "SUBSCRIPTION_GRACE_DAYS", 3, 1, 365),
    webhookSigningSecret: requireString(env, "WEBHOOK_SIGNING_SECRET"),
    renewalReminderDays: intInRange(env, "SUBSCRIPTION_RENEWAL_REMINDER_DAYS", 7, 1, 365),
    ...(env.DATABASE_URL && env.DATABASE_URL.length > 0 ? { database: { url: env.DATABASE_URL } } : {}),
  };
}
