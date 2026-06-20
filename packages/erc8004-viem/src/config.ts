/**
 * Config type + pure defaulting helper for the live viem ERC-8004 port.
 *
 * Pure — this is the config-defaulting unit-test seam. Defaults:
 * - `registries` -> `ARC_TESTNET_REGISTRIES` (from `@settlekit/arc-chains`)
 * - `rpcUrl`     -> `ARC_TESTNET_RPC_URL`    (from `@settlekit/erc8004`; note
 *   `@settlekit/arc-chains` does not export this constant standalone)
 *
 * No network, no clock. Secrets (`privateKey`) are NEVER hardcoded — the caller
 * supplies them from config/env.
 */

import type { PublicClient, WalletClient } from "viem";
import { ARC_TESTNET_REGISTRIES } from "@settlekit/arc-chains";
import type { Erc8004Registries } from "@settlekit/arc-chains";
import { ARC_TESTNET_RPC_URL } from "@settlekit/erc8004";

/** Caller-supplied configuration for {@link createViemErc8004Port}. */
export interface ViemErc8004Config {
  /** JSON-RPC endpoint. Defaults to `ARC_TESTNET_RPC_URL`. */
  rpcUrl?: string;
  /**
   * 0x-prefixed private key used to derive a signing account when no
   * `walletClient` is injected. Read from config/env — never hardcode.
   */
  privateKey?: `0x${string}`;
  /** Pre-built viem wallet client (must carry an account) for writes. */
  walletClient?: WalletClient;
  /** Pre-built viem public client for reads. */
  publicClient?: PublicClient;
  /** ERC-8004 registry addresses. Defaults to `ARC_TESTNET_REGISTRIES`. */
  registries?: Erc8004Registries;
}

/** Fully-defaulted config: `rpcUrl` and `registries` are always present. */
export interface ResolvedViemErc8004Config {
  rpcUrl: string;
  registries: Erc8004Registries;
  privateKey?: `0x${string}`;
  walletClient?: WalletClient;
  publicClient?: PublicClient;
}

/**
 * Apply defaults to a {@link ViemErc8004Config}. Returns a NEW object
 * (immutable — never mutates the input).
 */
export function resolveConfig(
  config: ViemErc8004Config = {},
): ResolvedViemErc8004Config {
  return {
    rpcUrl: config.rpcUrl ?? ARC_TESTNET_RPC_URL,
    registries: config.registries ?? ARC_TESTNET_REGISTRIES,
    privateKey: config.privateKey,
    walletClient: config.walletClient,
    publicClient: config.publicClient,
  };
}
