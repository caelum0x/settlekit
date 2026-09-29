/**
 * Environment-driven EVM chain selection (shared by the API and worker).
 *
 *   SETTLEKIT_CHAIN_ENV      mainnet | testnet (default testnet)
 *   ENABLED_EVM_CHAINS       comma list of chain keys; every other chain fails closed
 *   <KEY>_NETWORK            per-chain mainnet | testnet override
 *   <KEY>_RPC_URL            per-chain RPC (defaults to the registry RPC)
 *   <KEY>_MIN_CONFIRMATIONS  per-chain confirmation depth (defaults per chain)
 *   <KEY>_TOKEN_ADDRESS      token override — refused in production unless it
 *                            equals the registry address
 *
 * Legacy aliases stay enabled alongside ENABLED_EVM_CHAINS: BASE_RPC_URL
 * enables Base (mainnet unless BASE_NETWORK / SETTLEKIT_CHAIN_ENV say
 * otherwise) and ARC_CHAIN_ID enables Arc (testnet; ARC_USDC_ADDRESS is the
 * Arc token override).
 */

import { isAddress } from "viem";
import { EVM_CHAIN_KEYS, getEvmChain, isEvmChainKey, type ChainEnv, type EvmChainKey, type EvmChainSpec, type Hex } from "./registry.js";

export type Env = Readonly<Record<string, string | undefined>>;

export class ChainConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainConfigError";
  }
}

export interface EvmChainRuntimeConfig {
  key: EvmChainKey;
  spec: EvmChainSpec;
  rpcUrl: string;
  minConfirmations: number;
  tokenAddress: Hex;
}

export interface EvmChainsConfig {
  env: ChainEnv;
  enabled: Readonly<Partial<Record<EvmChainKey, EvmChainRuntimeConfig>>>;
  /** Non-fatal explanations (e.g. a legacy Arc chain id with no registry entry). */
  notes: readonly string[];
}

export function readEnv(env: Env, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

export function parseChainEnv(value: string | undefined, key: string): ChainEnv | undefined {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "mainnet" || normalized === "testnet") return normalized;
  throw new ChainConfigError(`${key} must be mainnet or testnet, got "${value}"`);
}

export function readInt(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = readEnv(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ChainConfigError(`${key} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return parsed;
}

function prefix(key: EvmChainKey): string {
  return key.toUpperCase();
}

function requestedKeys(env: Env): Set<EvmChainKey> {
  const raw = readEnv(env, "ENABLED_EVM_CHAINS");
  const keys = new Set<EvmChainKey>();
  for (const entry of (raw ?? "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)) {
    if (!isEvmChainKey(entry)) {
      throw new ChainConfigError(`ENABLED_EVM_CHAINS contains unknown chain "${entry}" (known: ${EVM_CHAIN_KEYS.join(", ")})`);
    }
    keys.add(entry);
  }
  if (readEnv(env, "BASE_RPC_URL") !== undefined) keys.add("base");
  if (readEnv(env, "ARC_CHAIN_ID") !== undefined) keys.add("arc");
  return keys;
}

function chainEnvFor(env: Env, key: EvmChainKey, globalEnv: ChainEnv | undefined, explicitList: ReadonlySet<string>): ChainEnv {
  const override = parseChainEnv(readEnv(env, `${prefix(key)}_NETWORK`), `${prefix(key)}_NETWORK`);
  if (override !== undefined) return override;
  if (key === "arc") return "testnet";
  // Legacy: BASE_RPC_URL alone historically meant Base mainnet.
  if (key === "base" && globalEnv === undefined && !explicitList.has("base")) return "mainnet";
  return globalEnv ?? "testnet";
}

function tokenFor(env: Env, key: EvmChainKey, spec: EvmChainSpec): Hex {
  const override = readEnv(env, `${prefix(key)}_TOKEN_ADDRESS`) ?? (key === "arc" ? readEnv(env, "ARC_USDC_ADDRESS") : undefined);
  if (override === undefined) return spec.token.address;
  if (!isAddress(override, { strict: false })) {
    throw new ChainConfigError(`${prefix(key)}_TOKEN_ADDRESS must be a 0x-prefixed 20-byte address`);
  }
  const matchesRegistry = override.toLowerCase() === spec.token.address.toLowerCase();
  if (!matchesRegistry && env.NODE_ENV === "production") {
    throw new ChainConfigError(
      `${prefix(key)} token override ${override} is refused in production; the verified ${spec.token.symbol} address is ${spec.token.address}`,
    );
  }
  return override as Hex;
}

function resolveChain(env: Env, key: EvmChainKey, chainEnv: ChainEnv): EvmChainRuntimeConfig {
  const spec = getEvmChain(key, chainEnv);
  if (spec === undefined) throw new ChainConfigError(`${key} has no ${chainEnv} deployment in the chain registry`);
  return {
    key,
    spec,
    rpcUrl: readEnv(env, `${prefix(key)}_RPC_URL`) ?? spec.defaultRpcUrl,
    minConfirmations: readInt(env, `${prefix(key)}_MIN_CONFIRMATIONS`, spec.minConfirmations, 1, 1_000),
    tokenAddress: tokenFor(env, key, spec),
  };
}

/** Resolve the enabled EVM chains from `env`. Throws {@link ChainConfigError}. */
export function loadEvmChains(env: Env): EvmChainsConfig {
  const globalEnv = parseChainEnv(readEnv(env, "SETTLEKIT_CHAIN_ENV"), "SETTLEKIT_CHAIN_ENV");
  const explicit = new Set((readEnv(env, "ENABLED_EVM_CHAINS") ?? "").split(",").map((part) => part.trim().toLowerCase()));
  const notes: string[] = [];
  const enabled: Partial<Record<EvmChainKey, EvmChainRuntimeConfig>> = {};
  for (const key of requestedKeys(env)) {
    if (key === "arc") {
      const legacyId = readEnv(env, "ARC_CHAIN_ID");
      const arcSpec = getEvmChain("arc", "testnet") as EvmChainSpec;
      if (legacyId !== undefined && Number(legacyId) !== arcSpec.chainId) {
        notes.push(`ARC_CHAIN_ID ${legacyId} is not in the chain registry; Arc payments fail closed`);
        continue;
      }
    }
    enabled[key] = resolveChain(env, key, chainEnvFor(env, key, globalEnv, explicit));
  }
  return { env: globalEnv ?? "testnet", enabled, notes };
}
