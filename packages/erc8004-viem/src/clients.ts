/**
 * Transport / wallet construction seam — the ONLY network-touching module.
 *
 * Reads (public client) work without a wallet; writes require a signing
 * account, supplied either as an injected `walletClient` (carrying its own
 * account) or as a 0x `privateKey` the adapter turns into an account via
 * `privateKeyToAccount`. The private key is read from config/env only — never
 * hardcoded.
 *
 * `deriveAccount` is exported separately so the deterministic key->address
 * derivation is unit-testable without constructing any transport.
 */

import { createPublicClient, createWalletClient, http } from "viem";
import type { Account, PublicClient, WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SettleKitError } from "@settlekit/common";
import { defineArcChain } from "./viem-chain.js";
import type { ResolvedViemErc8004Config } from "./config.js";

/** Resolved viem clients + the active signing account (if any). */
export interface ResolvedClients {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Account;
  /** The viem chain the clients are bound to (for `writeContract` calls). */
  chain: ReturnType<typeof defineArcChain>;
}

/**
 * Deterministically derive a viem account from a 0x private key. Pure wrapper
 * over viem's `privateKeyToAccount` — the unit-test seam for address derivation.
 */
export function deriveAccount(privateKey: `0x${string}`): Account {
  return privateKeyToAccount(privateKey);
}

/**
 * Build (or accept injected) viem clients from a resolved config.
 *
 * - `account`: from an injected wallet client, else derived from `privateKey`.
 * - `publicClient`: injected, else built from `rpcUrl` over the Arc chain.
 * - `walletClient`: injected, else built when an account is available.
 *
 * Does not throw when no wallet is present — read-only use is valid. Write paths
 * enforce a wallet via {@link requireWallet}.
 */
export function resolveClients(
  config: ResolvedViemErc8004Config,
): ResolvedClients {
  const chain = defineArcChain({ rpcUrl: config.rpcUrl });

  const account: Account | undefined =
    config.walletClient?.account ??
    (config.privateKey ? deriveAccount(config.privateKey) : undefined);

  const publicClient: PublicClient =
    config.publicClient ??
    createPublicClient({ chain, transport: http(config.rpcUrl) });

  const walletClient: WalletClient | undefined =
    config.walletClient ??
    (account
      ? createWalletClient({ account, chain, transport: http(config.rpcUrl) })
      : undefined);

  return { publicClient, walletClient, account, chain };
}

/**
 * Narrow the resolved clients to a write-capable pair, throwing a
 * `validation_error` when no wallet/account is configured.
 */
export function requireWallet(clients: ResolvedClients): {
  walletClient: WalletClient;
  account: Account;
} {
  if (!clients.walletClient || !clients.account) {
    throw new SettleKitError({
      code: "validation_error",
      message:
        "A wallet is required for this operation. Provide config.walletClient or config.privateKey.",
    });
  }
  return { walletClient: clients.walletClient, account: clients.account };
}
