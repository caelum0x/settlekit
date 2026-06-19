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

import { getArcChain, isArcAddress, type ArcAddress } from "@settlekit/arc";

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

/**
 * Circle developer-controlled wallets (W3S) used to EXECUTE payouts — moving
 * USDC from a SettleKit treasury wallet to a merchant. Distinct from
 * {@link CircleConfig} (the classic payments API).
 */
export interface CircleWalletsConfig {
  apiKey: string;
  /** The treasury wallet that funds payouts. */
  walletId: string;
  baseUrl?: string;
  /**
   * RSA-encrypted entity secret ciphertext. Circle expects a fresh ciphertext
   * per mutating request; a single configured value suits low-volume/dev use.
   * Leave unset to supply it per call from a KMS/signing service instead.
   */
  entitySecretCiphertext?: string;
}

/** Circle Gas Station — developer-sponsored gas via policies (W3S). */
export interface GasStationConfig {
  apiKey: string;
  baseUrl?: string;
  /** Override the policies REST path if your account exposes a different one. */
  policiesPath?: string;
}

/** Circle Mint — mint/redeem USDC & EURC against fiat. */
export interface CircleMintConfig {
  apiKey: string;
  baseUrl?: string;
}

/** Circle Compliance Engine — transaction (address) screening. */
export interface ComplianceConfig {
  apiKey: string;
  baseUrl?: string;
  /**
   * Circle chain id to screen against when a payout network has no direct Circle
   * mapping (e.g. Arc). Sanctioned addresses are chain-agnostic, so screening on
   * a supported chain (default "ETH") still catches them. Defaults to "ETH".
   */
  defaultChain: string;
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
  /** HMAC secret used to sign the `sk_session` cookie. */
  authCookieSecret: string;
  fileDelivery: FileDeliveryConfig;
  /** Override the CCTP Iris attestation base URL (defaults to testnet sandbox). */
  cctpIrisBaseUrl?: string;

  /** Optional integration groups — null when their creds are absent. */
  database: DatabaseConfig | null;
  arc: ArcConfig | null;
  circle: CircleConfig | null;
  circleWallets: CircleWalletsConfig | null;
  gasStation: GasStationConfig | null;
  circleMint: CircleMintConfig | null;
  compliance: ComplianceConfig | null;
  github: GithubConfig | null;
  discord: DiscordConfig | null;
  email: EmailConfig | null;
  s3: S3Config | null;

  /** Presence flags derived from the groups above. */
  hasDatabase: boolean;
  hasArc: boolean;
  hasCircle: boolean;
  hasCircleWallets: boolean;
  hasGasStation: boolean;
  hasCircleMint: boolean;
  hasCompliance: boolean;
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
  // Arc is enabled by setting ARC_CHAIN_ID. For a known Arc chain (e.g. testnet
  // 5042002) the RPC URL and USDC address default from the bundled chain
  // definition; both can be overridden via env for private RPCs or custom
  // deployments. For an unknown chain id, both must be supplied explicitly.
  if (optionalRaw(env, "ARC_CHAIN_ID") === undefined) {
    return null;
  }
  const chainId = requiredInt(env, "ARC_CHAIN_ID", 1, 2_147_483_647);
  const known = getArcChain(chainId);

  const usdcAddress = optionalRaw(env, "ARC_USDC_ADDRESS") ?? known?.tokens.USDC.address;
  if (usdcAddress === undefined) {
    throw new ConfigError(
      `ARC_USDC_ADDRESS is required for unknown Arc chain id ${chainId}`,
    );
  }
  if (!isArcAddress(usdcAddress)) {
    throw new ConfigError("Environment variable ARC_USDC_ADDRESS must be a 0x-prefixed 20-byte address");
  }

  const rpcUrl = optionalRaw(env, "ARC_RPC_URL") ?? known?.rpcUrl;
  if (rpcUrl === undefined) {
    throw new ConfigError(
      `ARC_RPC_URL is required for unknown Arc chain id ${chainId}`,
    );
  }

  return {
    rpcUrl,
    usdcAddress,
    chainId,
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

function loadCircleWallets(env: Env): CircleWalletsConfig | null {
  if (
    requireComplete("circleWallets", env, [
      "CIRCLE_WALLETS_API_KEY",
      "CIRCLE_WALLETS_WALLET_ID",
    ]) === "absent"
  ) {
    return null;
  }
  const baseUrl = optionalRaw(env, "CIRCLE_WALLETS_BASE_URL");
  const entitySecretCiphertext = optionalRaw(env, "CIRCLE_WALLETS_ENTITY_SECRET_CIPHERTEXT");
  return {
    apiKey: optionalRaw(env, "CIRCLE_WALLETS_API_KEY") as string,
    walletId: optionalRaw(env, "CIRCLE_WALLETS_WALLET_ID") as string,
    ...(baseUrl ? { baseUrl } : {}),
    ...(entitySecretCiphertext ? { entitySecretCiphertext } : {}),
  };
}

function loadGasStation(env: Env): GasStationConfig | null {
  if (requireComplete("gasStation", env, ["GAS_STATION_API_KEY"]) === "absent") return null;
  const baseUrl = optionalRaw(env, "GAS_STATION_BASE_URL");
  const policiesPath = optionalRaw(env, "GAS_STATION_POLICIES_PATH");
  return {
    apiKey: optionalRaw(env, "GAS_STATION_API_KEY") as string,
    ...(baseUrl ? { baseUrl } : {}),
    ...(policiesPath ? { policiesPath } : {}),
  };
}

function loadCircleMint(env: Env): CircleMintConfig | null {
  if (requireComplete("circleMint", env, ["CIRCLE_MINT_API_KEY"]) === "absent") return null;
  const baseUrl = optionalRaw(env, "CIRCLE_MINT_BASE_URL");
  return {
    apiKey: optionalRaw(env, "CIRCLE_MINT_API_KEY") as string,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function loadCompliance(env: Env): ComplianceConfig | null {
  if (requireComplete("compliance", env, ["COMPLIANCE_API_KEY"]) === "absent") return null;
  const baseUrl = optionalRaw(env, "COMPLIANCE_BASE_URL");
  return {
    apiKey: optionalRaw(env, "COMPLIANCE_API_KEY") as string,
    ...(baseUrl ? { baseUrl } : {}),
    defaultChain: optionalString(env, "COMPLIANCE_DEFAULT_CHAIN", "ETH"),
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
/**
 * Dev-only fallback secrets. They keep `pnpm dev` zero-config, but are public
 * (they live in this source file) so using them in production would let anyone
 * forge sessions, webhook signatures, and license tokens. {@link assertProductionReady}
 * rejects them when NODE_ENV=production.
 */
const DEV_DEFAULT_SECRETS = {
  LICENSE_TOKEN_SECRET: "settlekit-dev-license-secret",
  WEBHOOK_SIGNING_SECRET: "settlekit-dev-webhook-secret",
  AUTH_COOKIE_SECRET: "settlekit-dev-auth-cookie-secret",
} as const;

/**
 * Fail closed in production: a misconfigured deploy must crash on boot with a
 * clear message rather than silently running on in-memory data (lost on every
 * restart) or with publicly-known signing secrets. Dev/test keep the
 * convenient fallbacks.
 */
function assertProductionReady(
  env: Env,
  cfg: {
    database: DatabaseConfig | null;
    licenseTokenSecret: string;
    webhookSigningSecret: string;
    authCookieSecret: string;
  },
): void {
  if (env.NODE_ENV !== "production") return;
  const problems: string[] = [];
  if (cfg.database === null) {
    problems.push("DATABASE_URL must be set (in-memory stores lose all data on restart)");
  }
  if (cfg.licenseTokenSecret === DEV_DEFAULT_SECRETS.LICENSE_TOKEN_SECRET) {
    problems.push("LICENSE_TOKEN_SECRET must be set (the dev default is public and forgeable)");
  }
  if (cfg.webhookSigningSecret === DEV_DEFAULT_SECRETS.WEBHOOK_SIGNING_SECRET) {
    problems.push("WEBHOOK_SIGNING_SECRET must be set (the dev default is public and forgeable)");
  }
  if (cfg.authCookieSecret === DEV_DEFAULT_SECRETS.AUTH_COOKIE_SECRET) {
    problems.push("AUTH_COOKIE_SECRET must be set (the dev default is public and forgeable)");
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to boot in production with insecure configuration:\n  - ${problems.join("\n  - ")}`,
    );
  }
}

export function loadConfig(env: Env = process.env): ApiConfig {
  const database = loadDatabase(env);
  const arc = loadArc(env);
  const circle = loadCircle(env);
  const circleWallets = loadCircleWallets(env);
  const gasStation = loadGasStation(env);
  const circleMint = loadCircleMint(env);
  const compliance = loadCompliance(env);
  const github = loadGithub(env);
  const discord = loadDiscord(env);
  const email = loadEmail(env);
  const s3 = loadS3(env);

  const licenseTokenSecret = optionalString(env, "LICENSE_TOKEN_SECRET", DEV_DEFAULT_SECRETS.LICENSE_TOKEN_SECRET);
  const webhookSigningSecret = optionalString(env, "WEBHOOK_SIGNING_SECRET", DEV_DEFAULT_SECRETS.WEBHOOK_SIGNING_SECRET);
  const authCookieSecret = optionalString(env, "AUTH_COOKIE_SECRET", DEV_DEFAULT_SECRETS.AUTH_COOKIE_SECRET);

  assertProductionReady(env, { database, licenseTokenSecret, webhookSigningSecret, authCookieSecret });

  return {
    port: intInRange(env, "PORT", 8787, 1, 65_535),
    licenseTokenSecret,
    webhookSigningSecret,
    authCookieSecret,
    fileDelivery: loadFileDelivery(env),
    ...(optionalRaw(env, "CCTP_IRIS_BASE_URL")
      ? { cctpIrisBaseUrl: optionalRaw(env, "CCTP_IRIS_BASE_URL") as string }
      : {}),

    database,
    arc,
    circle,
    circleWallets,
    gasStation,
    circleMint,
    compliance,
    github,
    discord,
    email,
    s3,

    hasDatabase: database !== null,
    hasArc: arc !== null,
    hasCircle: circle !== null,
    hasCircleWallets: circleWallets !== null,
    hasGasStation: gasStation !== null,
    hasCircleMint: circleMint !== null,
    hasCompliance: compliance !== null,
    hasGithub: github !== null,
    hasDiscord: discord !== null,
    hasEmail: email !== null,
    hasS3: s3 !== null,
  };
}
