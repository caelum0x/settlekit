/**
 * Environment wiring for the self-hosted facilitator.
 *
 *   X402_RELAYER_PRIVATE_KEY          0x-prefixed 32-byte key; unset = facilitator off
 *   X402_FACILITATOR_NETWORKS         comma list (default ethereum,hyperevm,robinhood)
 *   X402_FACILITATOR_ALLOW_EXPERIMENTAL  1 to enable Tempo Permit2 / Robinhood testnet
 *   X402_FACILITATOR_MAX_AMOUNT       max USD per settlement (default 100)
 *   X402_FACILITATOR_ALLOWED_PAY_TO   comma list of recipient addresses, or "*" to settle
 *                                     to any recipient (default: the caller's
 *                                     defaultAllowedPayTo; empty refuses every recipient)
 *   X402_FACILITATOR_KILL             1 refuses every verify/settle (read per call)
 *   X402_GAS_MAX_FEE_<KEY>            per-settlement fee cap, native base units
 *   X402_GAS_DAILY_BUDGET_<KEY>       rolling 24h fee cap, native base units
 *   X402_GAS_MIN_BALANCE_<KEY>        relayer balance floor, native base units
 *   SETTLEKIT_CHAIN_ENV / <KEY>_NETWORK / <KEY>_RPC_URL  shared with @settlekit/chains
 *
 * Tempo has no default gas budget (fees are paid in a USD fee token whose
 * pricing is still experimental): set X402_GAS_MAX_FEE_TEMPO to enable it.
 */
import { isHex } from "viem";
import {
  ChainConfigError,
  isEvmChainKey,
  parseChainEnv,
  readEnv,
  type ChainEnv,
  type Env,
  type EvmChainKey,
  type Hex,
} from "@settlekit/chains";
import { getFacilitatorAsset, toAtomicAmount, type FacilitatorAsset } from "./assets.js";
import { createSettleKitFacilitator, type SettleKitFacilitator } from "./facilitator.js";
import { GasGuard, type NetworkGasBudget } from "./gas-guard.js";
import { InMemoryNonceStore, type NonceStore } from "./nonce-store.js";
import { createRelayer } from "./relayer.js";

export const DEFAULT_FACILITATOR_NETWORKS: readonly EvmChainKey[] = ["ethereum", "hyperevm", "robinhood"];

/** Conservative defaults (wei / HYPE-wei). Tempo intentionally has none. */
const DEFAULT_GAS: Readonly<Partial<Record<EvmChainKey, NetworkGasBudget>>> = {
  ethereum: { maxFeePerSettlement: 3_000_000_000_000_000n, dailyBudget: 50_000_000_000_000_000n },
  base: { maxFeePerSettlement: 200_000_000_000_000n, dailyBudget: 5_000_000_000_000_000n },
  arbitrum: { maxFeePerSettlement: 200_000_000_000_000n, dailyBudget: 5_000_000_000_000_000n },
  robinhood: { maxFeePerSettlement: 200_000_000_000_000n, dailyBudget: 5_000_000_000_000_000n },
  hyperevm: { maxFeePerSettlement: 20_000_000_000_000_000n, dailyBudget: 500_000_000_000_000_000n },
};

function readBigInt(env: Env, key: string): bigint | undefined {
  const raw = readEnv(env, key);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new ChainConfigError(`${key} must be a non-negative integer, got "${raw}"`);
  return BigInt(raw);
}

function networkEnv(env: Env, key: EvmChainKey): ChainEnv {
  return (
    parseChainEnv(readEnv(env, `${key.toUpperCase()}_NETWORK`), `${key.toUpperCase()}_NETWORK`) ??
    parseChainEnv(readEnv(env, "SETTLEKIT_CHAIN_ENV"), "SETTLEKIT_CHAIN_ENV") ??
    "testnet"
  );
}

function gasBudgetFor(env: Env, key: EvmChainKey): NetworkGasBudget | undefined {
  const upper = key.toUpperCase();
  const fallback = DEFAULT_GAS[key];
  const maxFee = readBigInt(env, `X402_GAS_MAX_FEE_${upper}`) ?? fallback?.maxFeePerSettlement;
  if (maxFee === undefined) return undefined;
  const daily = readBigInt(env, `X402_GAS_DAILY_BUDGET_${upper}`) ?? fallback?.dailyBudget;
  const minBalance = readBigInt(env, `X402_GAS_MIN_BALANCE_${upper}`);
  return {
    maxFeePerSettlement: maxFee,
    ...(daily !== undefined ? { dailyBudget: daily } : {}),
    ...(minBalance !== undefined ? { minRelayerBalance: minBalance } : {}),
  };
}

export function parseFacilitatorNetworks(env: Env): EvmChainKey[] {
  const raw = readEnv(env, "X402_FACILITATOR_NETWORKS");
  if (raw === undefined) return [...DEFAULT_FACILITATOR_NETWORKS];
  const keys = raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  for (const key of keys) {
    if (!isEvmChainKey(key)) throw new ChainConfigError(`X402_FACILITATOR_NETWORKS contains unknown chain "${key}"`);
  }
  return [...new Set(keys as EvmChainKey[])];
}

export interface FacilitatorFromEnv {
  facilitator: SettleKitFacilitator;
  relayerAddress: Hex;
  /** Enabled networks that were skipped (no asset, experimental, no gas budget). */
  skipped: readonly string[];
  /** Boot-time warnings (in-memory nonce store, closed recipient allowlist). */
  warnings: readonly string[];
}

/**
 * Build the facilitator from env, or null when X402_RELAYER_PRIVATE_KEY is
 * unset. Networks that cannot be enabled are skipped with a reason rather
 * than silently relayed.
 */
export interface LoadFacilitatorOptions {
  /** Recipient allowlist used when X402_FACILITATOR_ALLOWED_PAY_TO is unset. */
  defaultAllowedPayTo?: readonly string[];
  /**
   * Shared replay store (Postgres in production). Without one the facilitator
   * falls back to a process-local store and reports a warning: replay
   * protection then only holds within a single instance and is lost on restart.
   */
  nonceStore?: NonceStore;
}

/** Resolve the recipient allowlist: explicit env, else the caller's own recipients. */
export function resolveAllowedPayTo(env: Env, defaults: readonly string[] = []): readonly string[] | "any" {
  const configured = readEnv(env, "X402_FACILITATOR_ALLOWED_PAY_TO");
  if (configured === undefined) return [...new Set(defaults.map((address) => address.trim()).filter(Boolean))];
  if (configured.trim() === "*") return "any";
  return configured.split(",").map((part) => part.trim()).filter(Boolean);
}

export function loadFacilitatorFromEnv(env: Env = process.env, options: LoadFacilitatorOptions = {}): FacilitatorFromEnv | null {
  const privateKey = readEnv(env, "X402_RELAYER_PRIVATE_KEY");
  if (privateKey === undefined) return null;
  if (!isHex(privateKey) || privateKey.length !== 66) {
    throw new ChainConfigError("X402_RELAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  }
  const allowExperimental = readEnv(env, "X402_FACILITATOR_ALLOW_EXPERIMENTAL") === "1";
  const skipped: string[] = [];
  const enabled: Array<{ asset: FacilitatorAsset; rpcUrl?: string; budget: NetworkGasBudget }> = [];

  for (const key of parseFacilitatorNetworks(env)) {
    const chainEnv = networkEnv(env, key);
    const asset = getFacilitatorAsset(key, chainEnv);
    if (!asset) {
      skipped.push(`${key}: no settleable asset on ${chainEnv}`);
      continue;
    }
    if (asset.experimental && !allowExperimental) {
      skipped.push(`${key}: experimental on ${chainEnv} (set X402_FACILITATOR_ALLOW_EXPERIMENTAL=1)`);
      continue;
    }
    const budget = gasBudgetFor(env, key);
    if (!budget) {
      skipped.push(`${key}: no gas budget (set X402_GAS_MAX_FEE_${key.toUpperCase()})`);
      continue;
    }
    const rpcUrl = readEnv(env, `${key.toUpperCase()}_RPC_URL`);
    enabled.push({ asset, budget, ...(rpcUrl ? { rpcUrl } : {}) });
  }

  const relayer = createRelayer(privateKey as Hex, enabled);
  const gasGuard = new GasGuard(relayer.gasOracle, {
    networks: Object.fromEntries(enabled.map(({ asset, budget }) => [asset.caip2, budget])),
  });
  const maxAmount = BigInt(toAtomicAmount(readEnv(env, "X402_FACILITATOR_MAX_AMOUNT") ?? "100", 6));
  const allowedPayTo = resolveAllowedPayTo(env, options.defaultAllowedPayTo);
  const warnings: string[] = [];
  if (allowedPayTo !== "any" && allowedPayTo.length === 0) {
    warnings.push(
      "x402 facilitator refuses every recipient: set X402_EVM_PAY_TO / X402_PAY_TO_<CHAIN> or X402_FACILITATOR_ALLOWED_PAY_TO",
    );
  }
  if (allowedPayTo === "any") warnings.push("x402 facilitator settles to ANY recipient (X402_FACILITATOR_ALLOWED_PAY_TO=*)");
  const nonceStore = options.nonceStore ?? new InMemoryNonceStore();
  if (!options.nonceStore) {
    warnings.push("x402 facilitator is using an in-memory nonce store (local dev only): set DATABASE_URL for shared replay protection");
  }

  // Mixed environments are allowed per network (e.g. HyperEVM mainnet with
  // Robinhood testnet), so build one facilitator per environment in use.
  const envs = [...new Set(enabled.map(({ asset }) => asset.env))];
  const parts = envs.map((chainEnv) =>
    createSettleKitFacilitator({
      env: chainEnv,
      enabledNetworks: enabled.filter(({ asset }) => asset.env === chainEnv).map(({ asset }) => asset.network),
      allowExperimental,
      signerFor: relayer.signerFor,
      gasGuard,
      maxAmountPerSettlement: maxAmount,
      allowedPayTo,
      nonceStore,
      killSwitch: () => readEnv(env, "X402_FACILITATOR_KILL") === "1",
    }),
  );
  return { facilitator: combineFacilitators(parts), relayerAddress: relayer.address, skipped, warnings };
}

/** Route calls to the facilitator that owns the requirements' network. */
export function combineFacilitators(parts: readonly SettleKitFacilitator[]): SettleKitFacilitator {
  if (parts.length === 1) return parts[0] as SettleKitFacilitator;
  const owner = (network: string) => parts.find((part) => part.assets().some((asset) => asset.caip2 === network));
  const killed = () => parts.some((part) => part.killed());
  return {
    async verify(payload, requirements) {
      const part = owner(requirements.network);
      if (!part) return { isValid: false, invalidReason: "network_not_enabled", invalidMessage: `network ${requirements.network} is not enabled` };
      return part.verify(payload, requirements);
    },
    async settle(payload, requirements) {
      const part = owner(requirements.network);
      if (!part) {
        return { success: false, errorReason: "network_not_enabled", transaction: "", network: requirements.network };
      }
      return part.settle(payload, requirements);
    },
    async getSupported() {
      const all = await Promise.all(parts.map((part) => part.getSupported()));
      const signers: Record<string, string[]> = {};
      for (const supported of all) {
        for (const [family, addresses] of Object.entries(supported.signers)) {
          signers[family] = [...new Set([...(signers[family] ?? []), ...addresses])];
        }
      }
      return {
        kinds: all.flatMap((supported) => supported.kinds),
        extensions: [...new Set(all.flatMap((supported) => supported.extensions))],
        signers,
      };
    },
    assets: () => parts.flatMap((part) => part.assets()),
    killed,
  };
}
