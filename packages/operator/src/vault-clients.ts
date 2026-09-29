/**
 * Real viem clients for Arc (testnet by default) used by the VaultExecutor,
 * the viem signer transport and on-chain verification.
 */
import { ARC_TESTNET } from "@settlekit/arc";
import { createPublicClient, createWalletClient, defineChain, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { VaultPublicClient } from "./vault-executor.js";
import type { Hex, VaultWalletClient } from "./vault-transport.js";

export function arcChain(rpcUrl: string = ARC_TESTNET.rpcUrl, chainId: number = ARC_TESTNET.chainId): Chain {
  return defineChain({
    id: chainId,
    name: chainId === ARC_TESTNET.chainId ? ARC_TESTNET.name : `Arc ${chainId}`,
    // USDC is Arc's native gas token (18-decimal native representation).
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Arcscan", url: ARC_TESTNET.explorerUrl } },
  });
}

export function createArcPublicClient(chain: Chain): VaultPublicClient {
  return createPublicClient({ chain, transport: http() }) as unknown as VaultPublicClient;
}

export function createArcWalletClient(chain: Chain, privateKey: Hex): VaultWalletClient {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({ account, chain, transport: http() }) as unknown as VaultWalletClient;
}
