/**
 * Sidecar configuration (env-driven, with safe defaults for local runs).
 */

import type { PaymentNetwork } from "@settlekit/common";

export interface SidecarConfig {
  port: number;
  organizationId: string;
  /** Default per-citation toll when a feed item doesn't set one. */
  defaultPriceUsdc: string;
  network: PaymentNetwork;
  /** Wallet that holds earnings for not-yet-registered authors. */
  escrowWallet: string;
  /** Optional Arc indexer base URL; when set, tolls are verified on-chain. */
  indexerUrl?: string;
}

function env(vars: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = vars[name];
  return value !== undefined && value.length > 0 ? value : fallback;
}

export function loadConfig(vars: NodeJS.ProcessEnv = process.env): SidecarConfig {
  const indexerUrl = vars["ARC_INDEXER_URL"];
  return {
    port: Number(env(vars, "PORT", "8790")),
    organizationId: env(vars, "ORG_ID", "org_rss_citations"),
    defaultPriceUsdc: env(vars, "DEFAULT_TOLL_USDC", "0.0005"),
    network: env(vars, "NETWORK", "arc") as PaymentNetwork,
    escrowWallet: env(vars, "ESCROW_WALLET", "0x0000000000000000000000000000000000e5c70w"),
    ...(indexerUrl !== undefined && indexerUrl.length > 0 ? { indexerUrl } : {}),
  };
}
