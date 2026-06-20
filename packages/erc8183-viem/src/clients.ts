/**
 * viem client resolution.
 *
 * Injected clients are used verbatim (no transport is created) — this is what
 * the no-network tests depend on. When clients are NOT injected they are built
 * lazily from `rpcUrl` + the resolved chain/account, mirroring
 * `@settlekit/arc/src/rpc.ts` construction.
 */

import { createPublicClient, createWalletClient, http } from "viem";
import type { PublicClient, WalletClient } from "viem";
import { validationError } from "@settlekit/common";
import { defineArcChain } from "./chain.js";
import { resolveAccount } from "./account.js";
import type { ViemErc8183Config } from "./types.js";

function requireRpcUrl(config: ViemErc8183Config): string {
  if (!config.rpcUrl) {
    throw validationError(
      "No transport: supply config.publicClient/walletClient or config.rpcUrl.",
    );
  }
  return config.rpcUrl;
}

/**
 * Resolve a {@link PublicClient}: use `config.publicClient` if injected; else
 * build one from `rpcUrl` + the Arc chain (chainId override required).
 */
export function resolvePublicClient(config: ViemErc8183Config): PublicClient {
  if (config.publicClient) {
    return config.publicClient;
  }
  const rpcUrl = requireRpcUrl(config);
  return createPublicClient({
    chain: defineArcChain({ chainId: config.chainId, rpcUrl }),
    transport: http(rpcUrl),
  });
}

/**
 * Resolve a {@link WalletClient}: use `config.walletClient` if injected (it must
 * carry an account); else build one from `rpcUrl` + the resolved account/chain.
 * Throws `validation_error` if an injected wallet client has no account.
 */
export function resolveWalletClient(config: ViemErc8183Config): WalletClient {
  if (config.walletClient) {
    if (!config.walletClient.account) {
      throw validationError("Injected walletClient must have an account set.");
    }
    return config.walletClient;
  }
  const rpcUrl = requireRpcUrl(config);
  return createWalletClient({
    account: resolveAccount(config),
    chain: defineArcChain({ chainId: config.chainId, rpcUrl }),
    transport: http(rpcUrl),
  });
}
