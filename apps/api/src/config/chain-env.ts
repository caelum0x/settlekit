/**
 * Multi-chain configuration for the API: the enabled EVM chains (see
 * `loadEvmChains` in @settlekit/chains — SETTLEKIT_CHAIN_ENV,
 * ENABLED_EVM_CHAINS, per-chain RPC/NETWORK/MIN_CONFIRMATIONS, and the
 * BASE_RPC_URL / ARC_CHAIN_ID aliases), transparent Zcash and HyperCore
 * (HYPERCORE_ENABLED / HYPERCORE_NETWORK / HYPERCORE_API_URL). Chain config
 * errors surface as {@link ConfigError} so boot fails fast.
 */

import {
  ChainConfigError,
  loadEvmChains,
  loadZcashConfig,
  type EvmChainsConfig,
  type ZcashConfig,
} from "@settlekit/chains";
import { loadHyperCoreConfig, type HyperCoreConfig } from "@settlekit/hyperliquid";
import { ConfigError } from "./errors.js";

export interface ChainGroups {
  evm: EvmChainsConfig;
  zcash: ZcashConfig | null;
  hypercore: HyperCoreConfig | null;
}

type Env = Record<string, string | undefined>;

export function loadChainGroups(env: Env): ChainGroups {
  try {
    return { evm: loadEvmChains(env), zcash: loadZcashConfig(env), hypercore: loadHyperCoreConfig(env) };
  } catch (error) {
    if (error instanceof ChainConfigError) throw new ConfigError(error.message);
    throw error;
  }
}
