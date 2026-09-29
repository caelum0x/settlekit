/**
 * The networks a merchant can accept, as this deployment actually runs them.
 *
 * One row per payable network with the stablecoin a buyer sends, whether the
 * deployment runs it on mainnet or testnet, whether it can verify payments on
 * it at all (networks without a verifier fail closed), which address a
 * merchant pastes for it, and how to link a transaction. Honest labels come
 * from the chain registry: Robinhood Chain settles USDG, Tempo settles bridged
 * USDC.e, Zcash settles transparent ZEC.
 */
import type { PaymentNetwork } from "@settlekit/common";
import { getEvmChain, type ChainEnv, type EvmChainKey } from "@settlekit/chains";
import { SOLANA_CLUSTERS, USDC_MINT_DEVNET, USDC_MINT_MAINNET } from "@settlekit/solana";
import { hyperCoreTxUrl, defaultHyperliquidApiUrl } from "@settlekit/hyperliquid";
import { zcashExplorerTxUrl } from "@settlekit/zcash";
import { loadConfig, type ApiConfig } from "../config/env.js";

/** Which receiving address a network uses. EVM chains share one address. */
export type AddressGroup = "evm" | "solana" | "hypercore" | "zcash";

export interface NetworkInfo {
  network: PaymentNetwork;
  name: string;
  /** Asset the merchant receives, e.g. USDC, USDG, USDC.e, ZEC. */
  asset: string;
  env: ChainEnv;
  /** Whether this deployment can verify payments on the network. */
  enabled: boolean;
  addressGroup: AddressGroup;
  /** Honest disclosure shown next to the chain. */
  note?: string;
}

/** Networks offered to merchants, in display order (Arc is out of scope). */
export const MERCHANT_NETWORKS: readonly PaymentNetwork[] = [
  "solana",
  "base",
  "ethereum",
  "arbitrum",
  "robinhood",
  "hyperevm",
  "hypercore",
  "tempo",
  "zcash",
];

const EVM_NAMES: Record<string, string> = {
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  robinhood: "Robinhood Chain",
  hyperevm: "HyperEVM",
  tempo: "Tempo",
};

let cachedConfig: ApiConfig | null = null;

/** The API config (loaded once; boot already validated it). */
export function apiConfig(): ApiConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

function evmRow(key: EvmChainKey, cfg: ApiConfig): NetworkInfo {
  const runtime = cfg.evm.enabled[key];
  const env: ChainEnv = runtime?.spec.env ?? cfg.evm.env;
  const spec = runtime?.spec ?? getEvmChain(key, env);
  const asset = spec?.token.symbol ?? "USDC";
  const notes: string[] = [];
  if (key === "robinhood") notes.push(env === "mainnet" ? "Settles USDG (Paxos Global Dollar); no native USDC on Robinhood Chain" : "Testnet Mock USDC");
  if (key === "tempo") notes.push(env === "mainnet" ? "Settles USDC.e, bridged via Stargate" : "Testnet pathUSD / AlphaUSD");
  return {
    network: key as PaymentNetwork,
    name: EVM_NAMES[key] ?? key,
    asset,
    env,
    enabled: runtime !== undefined,
    addressGroup: "evm",
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
  };
}

/** Every merchant network with its live deployment status. */
export function networkCatalog(cfg: ApiConfig = apiConfig()): NetworkInfo[] {
  return MERCHANT_NETWORKS.map((network): NetworkInfo => {
    switch (network) {
      case "solana":
        return {
          network,
          name: "Solana",
          asset: "USDC",
          env: cfg.solana ? (cfg.solana.cluster === "devnet" ? "testnet" : "mainnet") : cfg.evm.env,
          enabled: cfg.solana !== null,
          addressGroup: "solana",
        };
      case "hypercore":
        return {
          network,
          name: "Hyperliquid (HyperCore)",
          asset: "USDC",
          env: cfg.hypercore?.network ?? cfg.evm.env,
          enabled: cfg.hypercore !== null,
          addressGroup: "hypercore",
          note: "Paid with usdSend into your Hyperliquid account balance",
        };
      case "zcash":
        return {
          network,
          name: "Zcash",
          asset: "ZEC",
          env: cfg.zcash?.network ?? "mainnet",
          enabled: cfg.zcash !== null,
          addressGroup: "zcash",
          note: "Transparent ZEC at a locked USD quote; payments are visible on-chain",
        };
      default:
        return evmRow(network as EvmChainKey, cfg);
    }
  });
}

/** Catalog row for one network. */
export function networkInfo(network: PaymentNetwork, cfg: ApiConfig = apiConfig()): NetworkInfo | undefined {
  return networkCatalog(cfg).find((row) => row.network === network);
}

/** Block-explorer link for a transaction, matched to the deployment's env. */
export function explorerTxUrl(network: PaymentNetwork, txHash: string, cfg: ApiConfig = apiConfig()): string | null {
  if (!txHash) return null;
  switch (network) {
    case "solana": {
      const cluster = cfg.solana?.cluster ?? (cfg.evm.env === "testnet" ? "devnet" : "mainnet");
      return `https://solscan.io/tx/${txHash}${SOLANA_CLUSTERS[cluster].explorerClusterParam}`;
    }
    case "hypercore":
      return hyperCoreTxUrl(txHash, cfg.hypercore?.network ?? cfg.evm.env);
    case "zcash":
      return zcashExplorerTxUrl(cfg.zcash?.network ?? "mainnet", txHash);
    default: {
      const key = network as EvmChainKey;
      const spec = cfg.evm.enabled[key]?.spec ?? getEvmChain(key, cfg.evm.env);
      return spec?.explorerTx(txHash) ?? null;
    }
  }
}

/** RPC / API endpoints used to read merchant balances. */
export function balanceEndpoints(cfg: ApiConfig = apiConfig()) {
  const solanaCluster = cfg.solana?.cluster ?? (cfg.evm.env === "testnet" ? "devnet" : "mainnet");
  return {
    solana: {
      rpcUrl: cfg.solana?.rpcUrl ?? SOLANA_CLUSTERS[solanaCluster].rpcUrl,
      mint: cfg.solana?.usdcMint ?? (solanaCluster === "mainnet" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET),
    },
    hypercore: {
      apiUrl: cfg.hypercore?.apiUrl ?? defaultHyperliquidApiUrl(cfg.hypercore?.network ?? cfg.evm.env),
    },
    zcash: {
      explorerUrl: cfg.zcash?.explorerUrl ?? "https://api.blockchair.com/zcash",
      network: cfg.zcash?.network ?? "mainnet",
      apiKey: cfg.zcash?.apiKey,
    },
  };
}
