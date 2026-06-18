/**
 * Navidrome scrobble sidecar configuration.
 */

import type { PaymentNetwork } from "@settlekit/common";

export interface NavidromeConfig {
  port: number;
  organizationId: string;
  network: PaymentNetwork;
  /** Amount paid to the artist per qualifying listen. */
  perListenUsdc: string;
  /** A play shorter than this many seconds is a skip and costs nothing. */
  minPlaySeconds: number;
  /** Optional per-listener daily spend cap. */
  perUserDailyCapUsdc?: string;
  /** Wallet that holds earnings for not-yet-registered artists. */
  escrowWallet: string;
}

function env(vars: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = vars[name];
  return value !== undefined && value.length > 0 ? value : fallback;
}

export function loadConfig(vars: NodeJS.ProcessEnv = process.env): NavidromeConfig {
  const cap = vars["PER_USER_DAILY_CAP_USDC"];
  return {
    port: Number(env(vars, "PORT", "8791")),
    organizationId: env(vars, "ORG_ID", "org_navidrome"),
    network: env(vars, "NETWORK", "arc") as PaymentNetwork,
    perListenUsdc: env(vars, "PER_LISTEN_USDC", "0.0002"),
    minPlaySeconds: Number(env(vars, "MIN_PLAY_SECONDS", "30")),
    ...(cap !== undefined && cap.length > 0 ? { perUserDailyCapUsdc: cap } : {}),
    escrowWallet: env(vars, "ESCROW_WALLET", "0x0000000000000000000000000000000000e5c70w"),
  };
}
