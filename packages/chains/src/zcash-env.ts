/**
 * Zcash settlement configuration from the environment.
 *
 *   ZCASH_ENABLED             true | 1 enables transparent Zcash (mainnet)
 *   ZCASH_EXPLORER_URL        Blockchair-compatible base URL (default Blockchair)
 *   BLOCKCHAIR_API_KEY        optional paid-tier key
 *   ZCASH_MIN_CONFIRMATIONS   default 3
 *   ZCASH_QUOTE_TTL_SEC       default 900 (15 minutes)
 */

import { BLOCKCHAIR_ZCASH_URL, DEFAULT_QUOTE_TTL_SEC, DEFAULT_ZCASH_MIN_CONFIRMATIONS, type ZcashNetwork } from "@settlekit/zcash";
import { ChainConfigError, readEnv, readInt, type Env } from "./env.js";

export interface ZcashConfig {
  network: ZcashNetwork;
  explorerUrl: string;
  apiKey?: string;
  minConfirmations: number;
  quoteTtlSec: number;
}

function enabledFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ChainConfigError(`ZCASH_ENABLED must be true or false, got "${value}"`);
}

/** Zcash config, or null when ZCASH_ENABLED is unset/false (fail closed). */
export function loadZcashConfig(env: Env): ZcashConfig | null {
  if (!enabledFlag(readEnv(env, "ZCASH_ENABLED"))) return null;
  const explorerUrl = readEnv(env, "ZCASH_EXPLORER_URL") ?? BLOCKCHAIR_ZCASH_URL;
  if (!/^https?:\/\//.test(explorerUrl)) throw new ChainConfigError("ZCASH_EXPLORER_URL must be an http(s) URL");
  const apiKey = readEnv(env, "BLOCKCHAIR_API_KEY");
  return {
    network: "mainnet",
    explorerUrl,
    ...(apiKey !== undefined ? { apiKey } : {}),
    minConfirmations: readInt(env, "ZCASH_MIN_CONFIRMATIONS", DEFAULT_ZCASH_MIN_CONFIRMATIONS, 1, 1_000),
    quoteTtlSec: readInt(env, "ZCASH_QUOTE_TTL_SEC", DEFAULT_QUOTE_TTL_SEC, 60, 3_600),
  };
}
