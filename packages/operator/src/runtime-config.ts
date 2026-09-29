/**
 * Operator runtime configuration from environment variables, validated at
 * startup (fail fast on partial or malformed configuration).
 */
import { ARC_TESTNET } from "@settlekit/arc";
import { validatePolicy, type OperatorPolicy } from "./policy.js";
import { parseUsdc } from "./usdc.js";
import type { Hex } from "./vault-transport.js";

export type Env = Readonly<Record<string, string | undefined>>;

export class OperatorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorConfigError";
  }
}

export type SignerConfig =
  | { readonly kind: "dcw"; readonly walletAddress: Hex }
  | { readonly kind: "viem"; readonly privateKey: Hex };

export interface OperatorConfig {
  readonly orgId: string;
  readonly databaseUrl?: string;
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly usdcAddress: Hex;
  readonly explorerUrl: string;
  readonly vault?: { readonly address: Hex; readonly operator: SignerConfig; readonly owner?: SignerConfig };
  readonly circle?: { readonly apiKey: string; readonly entitySecret?: string; readonly baseUrl?: string };
  readonly anthropicApiKey?: string;
  readonly models: { readonly routine?: string; readonly critical?: string };
  readonly defaults: OperatorPolicy;
  readonly alerts: { readonly resendApiKey?: string; readonly emailTo: readonly string[]; readonly emailFrom: string; readonly discordWebhookUrl?: string; readonly consoleUrl?: string };
  readonly x402?: { readonly walletId: string; readonly walletAddress: Hex; readonly tokenId: string; readonly allowedHosts: readonly string[] };
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const KEY_RE = /^0x[a-fA-F0-9]{64}$/;

function address(env: Env, name: string): Hex | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (!ADDRESS_RE.test(value)) throw new OperatorConfigError(`${name} must be a 0x address`);
  return value as Hex;
}

function list(env: Env, name: string): readonly string[] {
  return (env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function usdc(env: Env, name: string, fallback: bigint): bigint {
  const value = env[name]?.trim();
  if (!value) return fallback;
  if (value === "0") return 0n;
  return parseUsdc(value);
}

function signer(env: Env, role: "OPERATOR" | "OWNER", circle: boolean): SignerConfig | undefined {
  const key = env[`${role}_PRIVATE_KEY`]?.trim();
  const wallet = address(env, `${role}_WALLET_ADDRESS`);
  const prefer = env.OPERATOR_SIGNER?.trim();
  if (key && !KEY_RE.test(key)) throw new OperatorConfigError(`${role}_PRIVATE_KEY must be a 0x 32-byte hex key`);
  if (prefer === "viem" && key) return { kind: "viem", privateKey: key as Hex };
  if (wallet && circle) return { kind: "dcw", walletAddress: wallet };
  if (key) return { kind: "viem", privateKey: key as Hex };
  return undefined;
}

export function defaultPolicy(env: Env): OperatorPolicy {
  const policy: OperatorPolicy = {
    split: {
      OPERATING: Number(env.OPERATOR_SPLIT_OPERATING_BPS ?? 7000),
      YIELD: Number(env.OPERATOR_SPLIT_YIELD_BPS ?? 2000),
      REFUND: Number(env.OPERATOR_SPLIT_REFUND_BPS ?? 1000),
    },
    taxRateBps: Number(env.OPERATOR_TAX_RATE_BPS ?? 2500),
    perTxCap: usdc(env, "OPERATOR_PER_TX_CAP_USDC", 1000_000_000n),
    dailyCap: usdc(env, "OPERATOR_DAILY_CAP_USDC", 1500_000_000n),
    escalateAbove: usdc(env, "OPERATOR_ESCALATE_ABOVE_USDC", 500_000_000n),
    minFloat: usdc(env, "OPERATOR_MIN_FLOAT_USDC", 0n),
    yieldTarget: usdc(env, "OPERATOR_YIELD_TARGET_USDC", 0n),
    allowlist: list(env, "OPERATOR_ALLOWLIST").map((a) => {
      if (!ADDRESS_RE.test(a)) throw new OperatorConfigError(`OPERATOR_ALLOWLIST entry ${a} is not an address`);
      return a.toLowerCase();
    }),
    maxX402PerDay: Number(env.OPERATOR_MAX_X402_PER_DAY ?? 20),
  };
  const issues = validatePolicy(policy);
  if (issues.length > 0) throw new OperatorConfigError(`default policy invalid: ${issues.join("; ")}`);
  return policy;
}

export function loadOperatorConfig(env: Env, fallbackOrgId: string): OperatorConfig {
  const circleKey = env.CIRCLE_API_KEY?.trim();
  const entitySecret = env.CIRCLE_ENTITY_SECRET?.trim();
  const circle = circleKey ? { apiKey: circleKey, ...(entitySecret ? { entitySecret } : {}), ...(env.CIRCLE_W3S_BASE_URL ? { baseUrl: env.CIRCLE_W3S_BASE_URL } : {}) } : undefined;
  const dcwReady = Boolean(circle?.entitySecret);
  const vaultAddress = address(env, "OPERATOR_VAULT_ADDRESS");
  let vault: OperatorConfig["vault"];
  if (vaultAddress) {
    const operator = signer(env, "OPERATOR", dcwReady);
    if (!operator) {
      throw new OperatorConfigError("OPERATOR_VAULT_ADDRESS needs OPERATOR_WALLET_ADDRESS with CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET, or OPERATOR_PRIVATE_KEY");
    }
    const owner = signer(env, "OWNER", dcwReady);
    vault = { address: vaultAddress, operator, ...(owner ? { owner } : {}) };
  }
  const x402WalletId = env.OPERATOR_X402_WALLET_ID?.trim();
  const x402Address = address(env, "OPERATOR_WALLET_ADDRESS");
  const x402Token = env.ARC_USDC_TOKEN_ID?.trim();
  const x402 = x402WalletId && x402Address && x402Token && dcwReady
    ? { walletId: x402WalletId, walletAddress: x402Address, tokenId: x402Token, allowedHosts: list(env, "OPERATOR_X402_ALLOWED_HOSTS") }
    : undefined;
  return {
    orgId: env.OPERATOR_ORG_ID?.trim() || fallbackOrgId,
    ...(env.DATABASE_URL ? { databaseUrl: env.DATABASE_URL } : {}),
    rpcUrl: env.ARC_RPC_URL?.trim() || ARC_TESTNET.rpcUrl,
    chainId: Number(env.ARC_CHAIN_ID ?? ARC_TESTNET.chainId),
    usdcAddress: (address(env, "ARC_USDC_ADDRESS") ?? ARC_TESTNET.tokens.USDC.address) as Hex,
    explorerUrl: env.ARC_EXPLORER_URL?.trim() || ARC_TESTNET.explorerUrl,
    ...(vault ? { vault } : {}),
    ...(circle ? { circle } : {}),
    ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
    models: { routine: env.OPERATOR_MODEL_ROUTINE?.trim() || undefined, critical: env.OPERATOR_MODEL_CRITICAL?.trim() || undefined },
    defaults: defaultPolicy(env),
    alerts: {
      ...(env.RESEND_API_KEY ? { resendApiKey: env.RESEND_API_KEY } : {}),
      emailTo: list(env, "OPERATOR_ALERT_EMAIL"),
      emailFrom: env.OPERATOR_ALERT_FROM?.trim() || "SettleKit Operator <operator@settlekit.dev>",
      ...(env.OPERATOR_DISCORD_WEBHOOK_URL ? { discordWebhookUrl: env.OPERATOR_DISCORD_WEBHOOK_URL } : {}),
      ...(env.OPERATOR_CONSOLE_URL ? { consoleUrl: env.OPERATOR_CONSOLE_URL } : {}),
    },
    ...(x402 ? { x402 } : {}),
  };
}
