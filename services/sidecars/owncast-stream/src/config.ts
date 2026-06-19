/**
 * Owncast per-second streaming sidecar configuration.
 */

import type { PaymentNetwork } from "@settlekit/common";

export interface OwncastConfig {
  port: number;
  organizationId: string;
  network: PaymentNetwork;
  /** Rate paid to the streamer per second watched. */
  perSecondUsdc: string;
  /** Maximum a single viewer session commits (the reserve). */
  reserveUsdc: string;
  /** Wallet that holds earnings for not-yet-registered streamers. */
  escrowWallet: string;
  /** When set, guarded endpoints require `Authorization: Bearer <token>`. */
  authToken?: string;
}

function env(vars: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = vars[name];
  return value !== undefined && value.length > 0 ? value : fallback;
}

export function loadConfig(vars: NodeJS.ProcessEnv = process.env): OwncastConfig {
  const authToken = vars["SIDECAR_AUTH_TOKEN"];
  return {
    port: Number(env(vars, "PORT", "8792")),
    organizationId: env(vars, "ORG_ID", "org_owncast"),
    network: env(vars, "NETWORK", "arc") as PaymentNetwork,
    perSecondUsdc: env(vars, "PER_SECOND_USDC", "0.0001"),
    reserveUsdc: env(vars, "RESERVE_USDC", "0.05"),
    escrowWallet: env(vars, "ESCROW_WALLET", "0x0000000000000000000000000000000000e5c70w"),
    ...(authToken !== undefined && authToken.length > 0 ? { authToken } : {}),
  };
}
