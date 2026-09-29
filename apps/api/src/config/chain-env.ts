/**
 * Multi-chain configuration for the API: the enabled EVM chains (see
 * `loadEvmChains` in @settlekit/chains — SETTLEKIT_CHAIN_ENV,
 * ENABLED_EVM_CHAINS, per-chain RPC/NETWORK/MIN_CONFIRMATIONS, and the
 * BASE_RPC_URL / ARC_CHAIN_ID aliases) and transparent Zcash. Chain config
 * errors surface as {@link ConfigError} so boot fails fast.
 */

import {
  ChainConfigError,
  loadEvmChains,
  loadZcashConfig,
  type EvmChainsConfig,
  type ZcashConfig,
} from "@settlekit/chains";
import { ConfigError } from "./errors.js";

export interface ChainGroups {
  evm: EvmChainsConfig;
  zcash: ZcashConfig | null;
}

type Env = Record<string, string | undefined>;

export function loadChainGroups(env: Env): ChainGroups {
  try {
    return { evm: loadEvmChains(env), zcash: loadZcashConfig(env) };
  } catch (error) {
    if (error instanceof ChainConfigError) throw new ConfigError(error.message);
    throw error;
  }
}
