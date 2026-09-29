/**
 * Display formatting helpers for the checkout UI. Pure functions, no I/O.
 */
import type { Money, PaymentNetwork } from "@settlekit/common";
import { getEvmChain } from "@settlekit/chains";

/** Format a Money value as "25.50 USDC" with grouped thousands. */
export function formatMoney(value: Money): string {
  return `${formatAmount(value.amount)} ${value.currency}`;
}

/** Format a bare decimal amount string with thousands separators. */
export function formatAmount(amount: string): string {
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [wholeRaw, frac] = unsigned.split(".");
  const whole = (wholeRaw ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${body}` : body;
}

/** Environment a network settles on (Solana devnet counts as testnet). */
export type ChainEnvName = "mainnet" | "testnet";

/** Honest disclosure badges shown next to a network. */
export type NetworkBadge = "testnet" | "bridged" | "transparent";

export type NetworkFamilyName = "solana" | "evm" | "zcash" | "hypercore";

/** Display facts for one network on one environment. */
export interface NetworkLabel {
  network: PaymentNetwork;
  family: NetworkFamilyName;
  /** e.g. "Base Sepolia", "Robinhood Chain", "Zcash". */
  name: string;
  /** Settlement asset symbol: USDC, USDG, USDC.e, pathUSD or ZEC. */
  asset: string;
  badges: NetworkBadge[];
}

const OTHER_ENV: Readonly<Record<ChainEnvName, ChainEnvName>> = { mainnet: "testnet", testnet: "mainnet" };

/** Describe `network` on `env` from the verified chain registry. */
export function describeNetwork(network: PaymentNetwork, env: ChainEnvName = "mainnet"): NetworkLabel {
  if (network === "solana") {
    return {
      network,
      family: "solana",
      name: env === "testnet" ? "Solana Devnet" : "Solana",
      asset: "USDC",
      badges: env === "testnet" ? ["testnet"] : [],
    };
  }
  if (network === "zcash") {
    // Transparent t-addresses only, mainnet only (no public testnet explorer).
    return { network, family: "zcash", name: "Zcash", asset: "ZEC", badges: ["transparent"] };
  }
  if (network === "hypercore") {
    // Hyperliquid L1 perps-account USDC (usdSend), not an EVM token balance.
    return {
      network,
      family: "hypercore",
      name: env === "testnet" ? "HyperCore Testnet" : "HyperCore",
      asset: "USDC",
      badges: env === "testnet" ? ["testnet"] : [],
    };
  }
  // Arc has no mainnet yet: fall back to whichever environment exists.
  const spec = getEvmChain(network, env) ?? getEvmChain(network, OTHER_ENV[env]);
  if (spec === undefined) return { network, family: "evm", name: network, asset: "USDC", badges: [] };
  const badges: NetworkBadge[] = [];
  if (spec.env === "testnet") badges.push("testnet");
  if (spec.label === "bridged") badges.push("bridged");
  return { network, family: "evm", name: spec.name, asset: spec.token.symbol, badges };
}

/** Human label for a payment network. */
export function formatNetwork(network: PaymentNetwork, env: ChainEnvName = "mainnet"): string {
  return describeNetwork(network, env).name;
}

/** Settlement asset symbol on a network (USDC / USDG / USDC.e / pathUSD / ZEC). */
export function formatAsset(network: PaymentNetwork, env: ChainEnvName = "mainnet"): string {
  return describeNetwork(network, env).asset;
}

/** Visible text of a disclosure badge. */
export function badgeText(badge: NetworkBadge): string {
  switch (badge) {
    case "testnet":
      return "Testnet";
    case "bridged":
      return "Bridged";
    case "transparent":
      return "Transparent";
  }
}

/** One-line explanation of a badge (tooltips / screen readers). */
export function badgeDescription(badge: NetworkBadge): string {
  switch (badge) {
    case "testnet":
      return "Test network: tokens have no real value.";
    case "bridged":
      return "Bridged stablecoin, not natively issued on this chain.";
    case "transparent":
      return "Transparent Zcash payment: amount and addresses are visible on-chain.";
  }
}

/** Solana cluster a checkout settles on (mirrors @settlekit/solana, client-safe). */
export type SolanaClusterName = "mainnet" | "devnet";

export interface ExplorerOptions {
  solanaCluster?: SolanaClusterName;
  /** Environment the EVM chain runs on (defaults to mainnet). */
  chainEnv?: ChainEnvName;
}

/** Block explorer link for a network + tx hash ("" when none exists). */
export function explorerTxUrl(network: PaymentNetwork, txHash: string, options: ExplorerOptions = {}): string {
  const hash = encodeURIComponent(txHash);
  if (network === "solana") {
    return `https://solscan.io/tx/${hash}${options.solanaCluster === "devnet" ? "?cluster=devnet" : ""}`;
  }
  if (network === "zcash") return `https://blockchair.com/zcash/transaction/${hash}`;
  if (network === "hypercore") {
    const host = options.chainEnv === "testnet" ? "app.hyperliquid-testnet.xyz" : "app.hyperliquid.xyz";
    return `https://${host}/explorer/tx/${hash}`;
  }
  const env = options.chainEnv ?? "mainnet";
  const spec = getEvmChain(network, env) ?? getEvmChain(network, OTHER_ENV[env]);
  return spec?.explorerTx(hash) ?? "";
}

/** Short-form an address or hash: 0x1234…cdef. */
export function truncateMiddle(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Format an ISO timestamp for display, e.g. "Jan 1, 2026, 14:05 UTC". */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

/** Human "in 6 days" / "expired" relative label for an expiry timestamp. */
export function formatExpiry(iso: string, now: Date = new Date()): string {
  const expires = new Date(iso).getTime();
  const diffMs = expires - now.getTime();
  if (diffMs <= 0) return "Expired";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `Expires in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Expires in ${hours} hr`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

/** True when amount a is strictly greater than zero. */
export function isPositive(value: Money): boolean {
  return Number(value.amount) > 0;
}
