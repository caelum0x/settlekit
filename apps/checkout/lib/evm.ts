/**
 * EVM settlement runtime for the hosted checkout.
 *
 * Uses the SAME loader as the API and worker (`loadEvmChains` from
 * @settlekit/chains), so one set of env vars enables a chain everywhere:
 *
 *   SETTLEKIT_CHAIN_ENV       mainnet | testnet (default testnet)
 *   ENABLED_EVM_CHAINS        comma list: ethereum,base,arbitrum,robinhood,hyperevm,tempo,arc
 *   <KEY>_NETWORK             per-chain mainnet | testnet override
 *   <KEY>_RPC_URL             per-chain RPC (defaults to the registry RPC)
 *   <KEY>_MIN_CONFIRMATIONS   per-chain confirmation depth
 *   BASE_RPC_URL / ARC_CHAIN_ID  legacy aliases (enable Base / Arc)
 *
 * FAIL CLOSED: a chain that is not enabled has no verifier, and a broken
 * configuration yields an error value (never an empty "everything passes").
 */
import {
  ChainConfigError,
  createChainRpc,
  createEvmVerifier,
  isEvmNetwork,
  loadEvmChains,
  type EvmChainKey,
  type EvmChainRuntimeConfig,
  type EvmChainsConfig,
  type EvmVerifier,
} from "@settlekit/chains";
import type { FullEvmRpc } from "@settlekit/arc";
import type { PaymentNetwork } from "@settlekit/common";

type Env = Readonly<Record<string, string | undefined>>;

/** Enabled EVM chains plus one verifier per chain. */
export interface EvmRuntime {
  config: EvmChainsConfig;
  verifiers: Readonly<Partial<Record<EvmChainKey, EvmVerifier>>>;
}

export type EvmRuntimeResult = { ok: true; runtime: EvmRuntime } | { ok: false; error: string };

/** The env keys that shape the EVM runtime (cache key). */
const PREFIXES = ["ETHEREUM", "BASE", "ARBITRUM", "ROBINHOOD", "HYPEREVM", "TEMPO", "ARC"];
const SUFFIXES = ["RPC_URL", "NETWORK", "MIN_CONFIRMATIONS", "TOKEN_ADDRESS"];
const RELEVANT_KEYS = [
  "SETTLEKIT_CHAIN_ENV",
  "ENABLED_EVM_CHAINS",
  "ARC_CHAIN_ID",
  "ARC_USDC_ADDRESS",
  "NODE_ENV",
  ...PREFIXES.flatMap((prefix) => SUFFIXES.map((suffix) => `${prefix}_${suffix}`)),
];

export interface EvmRuntimeDeps {
  /** Inject RPCs per chain (tests); defaults to viem over the configured URL. */
  rpcs?: Partial<Record<EvmChainKey, FullEvmRpc>>;
}

/** Build the runtime from `env` (no caching). */
export function loadEvmRuntime(env: Env, deps: EvmRuntimeDeps = {}): EvmRuntimeResult {
  let config: EvmChainsConfig;
  try {
    config = loadEvmChains(env);
  } catch (error) {
    if (error instanceof ChainConfigError) return { ok: false, error: `EVM chain configuration error: ${error.message}` };
    throw error;
  }
  const verifiers: Partial<Record<EvmChainKey, EvmVerifier>> = {};
  for (const chain of Object.values(config.enabled)) {
    if (chain === undefined) continue;
    verifiers[chain.key] = createEvmVerifier({
      spec: chain.spec,
      rpc: deps.rpcs?.[chain.key] ?? createChainRpc(chain.spec, chain.rpcUrl),
      minConfirmations: chain.minConfirmations,
      tokenAddress: chain.tokenAddress,
    });
  }
  return { ok: true, runtime: { config, verifiers } };
}

let cached: { key: string; result: EvmRuntimeResult } | undefined;

/** The process-wide EVM runtime (verifiers reused while config is unchanged). */
export function getEvmRuntime(env: Env = process.env): EvmRuntimeResult {
  const key = JSON.stringify(RELEVANT_KEYS.map((name) => env[name] ?? null));
  if (cached?.key !== key) cached = { key, result: loadEvmRuntime(env) };
  return cached.result;
}

/** The enabled chain for `network`, or undefined (not EVM / not enabled). */
export function enabledEvmChain(
  result: EvmRuntimeResult | undefined,
  network: PaymentNetwork,
): EvmChainRuntimeConfig | undefined {
  if (!result?.ok || !isEvmNetwork(network)) return undefined;
  return result.runtime.config.enabled[network];
}

/** Why `network` cannot be paid here (undefined when it can). */
export function evmUnavailableReason(result: EvmRuntimeResult | undefined, network: PaymentNetwork): string | undefined {
  if (result === undefined) return `${network} payments are not configured on this checkout.`;
  if (!result.ok) return result.error;
  if (!isEvmNetwork(network)) return `${network} is not an EVM network.`;
  if (result.runtime.verifiers[network] === undefined) {
    return `${network} payments are not enabled on this checkout (add it to ENABLED_EVM_CHAINS).`;
  }
  return undefined;
}
