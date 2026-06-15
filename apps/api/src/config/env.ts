/**
 * Environment-driven configuration for the SettleKit API.
 *
 * Mirrors the worker's `loadConfig` (apps/worker/src/config.ts) in shape and
 * validation style, but every integration group is OPTIONAL: the API must boot
 * with NONE of them configured, falling back to the in-memory clients in
 * `src/clients/`. A group that is only PARTIALLY set (e.g. a GitHub App id with
 * no private key) is a misconfiguration and fails fast with a {@link ConfigError}.
 *
 * Boolean `has*` flags let the wiring layer decide, per integration, whether to
 * construct the REAL client or fall back to the in-memory double.
 */

import { isArcAddress, type ArcAddress } from "@settlekit/arc";

/** Raised when an environment group is partially set or a value is malformed. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

/** Optional Postgres connection. */
export interface DatabaseConfig {
  url: string;
}

/** Arc (EVM USDC) settlement reader configuration. */
export interface ArcConfig {
  rpcUrl: string;
  usdcAddress: ArcAddress;
  chainId: number;
  /** Confirmations required before a payment is treated as settled. */
  minConfirmations: number;
}

/** Circle REST client configuration. */
export interface CircleConfig {
  apiKey: string;
  baseUrl?: string;
}

/** GitHub App credentials used to mint installation-scoped clients. */
export interface GithubConfig {
  appId: number;
  privateKey: string;
  installationId: number;
  webhookSecret?: string;
}

/** Discord bot credentials used for role automation. */
export interface DiscordConfig {
  botToken: string;
}

/** Transactional email sender configuration (Resend). */
export interface EmailConfig {
  apiKey: string;
  from: string;
}

/** Object-storage configuration for file delivery. */
export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

/** File-delivery signed-URL configuration (always present, with defaults). */
export interface FileDeliveryConfig {
  baseUrl: string;
  secret: string;
  defaultExpiresInSec: number;
  defaultMaxDownloads: number;
}

/** Fully-resolved API configuration. */
export interface ApiConfig {
  /** Always present. */
  port: number;
  licenseTokenSecret: string;
  webhookSigningSecret: string;
  fileDelivery: FileDeliveryConfig;

  /** Optional integration groups — null when their creds are absent. */
  database: DatabaseConfig | null;
  arc: ArcConfig | null;
  circle: CircleConfig | null;
  github: GithubConfig | null;
  discord: DiscordConfig | null;
  email: EmailConfig | null;
  s3: S3Config | null;

  /** Presence flags derived from the groups above. */
  hasDatabase: boolean;
  hasArc: boolean;
  hasCircle: boolean;
  hasGithub: boolean;
  hasDiscord: boolean;
  hasEmail: boolean;
  hasS3: boolean;
}

// --- primitive readers ---------------------------------------------------

function optionalRaw(env: Env, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function optionalString(env: Env, key: string, fallback: string): string {
  return optionalRaw(env, key) ?? fallback;
}

function intInRange(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = optionalRaw(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new ConfigError(`Environment variable ${key} must be an integer, got "${raw}"`);
  }
  if (parsed < min || parsed > max) {
    throw new ConfigError(`Environment variable ${key} must be between ${min} and ${max}, got ${parsed}`);
  }
  return parsed;
}

function requiredInt(env: Env, key: string, min: number, max: number): number {
  const raw = optionalRaw(env, key);
  if (raw === undefined) {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new ConfigError(`Environment variable ${key} must be an integer, got "${raw}"`);
  }
  if (parsed < min || parsed > max) {
    throw new ConfigError(`Environment variable ${key} must be between ${min} and ${max}, got ${parsed}`);
  }
  return parsed;
}

/**
 * Resolve an OPTIONAL group: returns `null` when every key is unset, and throws
 * a {@link ConfigError} listing the missing keys when the group is partially set.
 */
function presentKeys(env: Env, keys: readonly string[]): string[] {
  return keys.filter((key) => optionalRaw(env, key) !== undefined);
}

function requireComplete(group: string, env: Env, requiredKeys: readonly string[]): "absent" | "present" {
  const present = presentKeys(env, requiredKeys);
  if (present.length === 0) return "absent";
  if (present.length === requiredKeys.length) return "present";
  const missing = requiredKeys.filter((key) => optionalRaw(env, key) === undefined);
  throw new ConfigError(
    `Incomplete ${group} configuration: set [${missing.join(", ")}] or unset [${present.join(", ")}]`,
  );
}

// --- group loaders -------------------------------------------------------

function loadDatabase(env: Env): DatabaseConfig | null {
  const url = optionalRaw(env, "DATABASE_URL");
  return url ? { url } : null;
}

function loadArc(env: Env): ArcConfig | null {
  if (requireComplete("arc", env, ["ARC_RPC_URL", "ARC_USDC_ADDRESS", "ARC_CHAIN_ID"]) === "absent") {
    return null;
  }
  const usdcAddress = optionalRaw(env, "ARC_USDC_ADDRESS") as string;
  if (!isArcAddress(usdcAddress)) {
    throw new ConfigError("Environment variable ARC_USDC_ADDRESS must be a 0x-prefixed 20-byte address");
  }
  return {
    rpcUrl: optionalRaw(env, "ARC_RPC_URL") as string,
    usdcAddress,
    chainId: requiredInt(env, "ARC_CHAIN_ID", 1, 2_147_483_647),
    minConfirmations: intInRange(env, "ARC_MIN_CONFIRMATIONS", 3, 1, 1_000),
  };
}

function loadCircle(env: Env): CircleConfig | null {
  if (requireComplete("circle", env, ["CIRCLE_API_KEY"]) === "absent") return null;
  const baseUrl = optionalRaw(env, "CIRCLE_BASE_URL");
  return {
    apiKey: optionalRaw(env, "CIRCLE_API_KEY") as string,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function loadGithub(env: Env): GithubConfig | null {
  if (
    requireComplete("github", env, [
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_INSTALLATION_ID",
    ]) === "absent"
  ) {
    return null;
  }
  const webhookSecret = optionalRaw(env, "GITHUB_WEBHOOK_SECRET");
  return {
    appId: requiredInt(env, "GITHUB_APP_ID", 1, 2_147_483_647),
    privateKey: optionalRaw(env, "GITHUB_APP_PRIVATE_KEY") as string,
    installationId: requiredInt(env, "GITHUB_INSTALLATION_ID", 1, 2_147_483_647),
    ...(webhookSecret ? { webhookSecret } : {}),
  };
}

function loadDiscord(env: Env): DiscordConfig | null {
  if (requireComplete("discord", env, ["DISCORD_BOT_TOKEN"]) === "absent") return null;
  return { botToken: optionalRaw(env, "DISCORD_BOT_TOKEN") as string };
}

function loadEmail(env: Env): EmailConfig | null {
  if (requireComplete("email", env, ["RESEND_API_KEY", "EMAIL_FROM"]) === "absent") return null;
  return {
    apiKey: optionalRaw(env, "RESEND_API_KEY") as string,
    from: optionalRaw(env, "EMAIL_FROM") as string,
  };
}

function loadS3(env: Env): S3Config | null {
  if (
    requireComplete("s3", env, [
      "S3_BUCKET",
      "S3_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ]) === "absent"
  ) {
    return null;
  }
  const endpoint = optionalRaw(env, "S3_ENDPOINT");
  return {
    bucket: optionalRaw(env, "S3_BUCKET") as string,
    region: optionalRaw(env, "S3_REGION") as string,
    accessKeyId: optionalRaw(env, "S3_ACCESS_KEY_ID") as string,
    secretAccessKey: optionalRaw(env, "S3_SECRET_ACCESS_KEY") as string,
    ...(endpoint ? { endpoint } : {}),
  };
}

function loadFileDelivery(env: Env): FileDeliveryConfig {
  return {
    baseUrl: optionalString(env, "FILE_DOWNLOAD_BASE_URL", "http://localhost:8787/v1/files/download"),
    secret: optionalString(env, "FILE_DOWNLOAD_SECRET", "settlekit-dev-file-secret"),
    defaultExpiresInSec: intInRange(env, "FILE_DOWNLOAD_EXPIRES_SEC", 3_600, 60, 2_592_000),
    defaultMaxDownloads: intInRange(env, "FILE_DOWNLOAD_MAX_DOWNLOADS", 3, 1, 10_000),
  };
}

/**
 * Build {@link ApiConfig} from a process environment. Defaults to `process.env`
 * but accepts an explicit env map for tests.
 */
export function loadConfig(env: Env = process.env): ApiConfig {
  const database = loadDatabase(env);
  const arc = loadArc(env);
  const circle = loadCircle(env);
  const github = loadGithub(env);
  const discord = loadDiscord(env);
  const email = loadEmail(env);
  const s3 = loadS3(env);

  return {
    port: intInRange(env, "PORT", 8787, 1, 65_535),
    licenseTokenSecret: optionalString(env, "LICENSE_TOKEN_SECRET", "settlekit-dev-license-secret"),
    webhookSigningSecret: optionalString(env, "WEBHOOK_SIGNING_SECRET", "settlekit-dev-webhook-secret"),
    fileDelivery: loadFileDelivery(env),

    database,
    arc,
    circle,
    github,
    discord,
    email,
    s3,

    hasDatabase: database !== null,
    hasArc: arc !== null,
    hasCircle: circle !== null,
    hasGithub: github !== null,
    hasDiscord: discord !== null,
    hasEmail: email !== null,
    hasS3: s3 !== null,
  };
}
