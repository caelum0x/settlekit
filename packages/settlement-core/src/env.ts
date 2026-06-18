/**
 * Select a settlement backend from environment configuration, so a deployment
 * flips from the local provider to real Circle settlement without code changes:
 *
 *   SETTLEMENT_PROVIDER=circle
 *   CIRCLE_WALLETS_API_KEY=...  CIRCLE_WALLET_ID=...  CIRCLE_USDC_TOKEN_ID=...
 *   CIRCLE_API_BASE_URL=https://api-sandbox.circle.com   # optional (sandbox)
 *
 * Gateway settlement needs an EIP-712 signer + tx submitter, so it is wired by
 * the host via {@link configureSettlement} with a GatewayTransferPort rather
 * than from env alone.
 */

import { createWalletsClient } from "@settlekit/circle-wallets";
import { CircleSettlementProvider } from "./circle-provider.js";
import { LocalSettlementProvider } from "./local-provider.js";
import type { SettlementProvider } from "./types.js";

/** A minimal env bag (avoids a hard dependency on Node's process types). */
export type EnvLike = Record<string, string | undefined>;

/**
 * Build the settlement provider described by `env`. Returns a
 * {@link CircleSettlementProvider} when `SETTLEMENT_PROVIDER=circle` and the
 * Circle credentials are present; otherwise a {@link LocalSettlementProvider}.
 */
export function settlementProviderFromEnv(env: EnvLike): SettlementProvider {
  if (env["SETTLEMENT_PROVIDER"] === "circle") {
    const apiKey = env["CIRCLE_WALLETS_API_KEY"];
    const walletId = env["CIRCLE_WALLET_ID"];
    const tokenId = env["CIRCLE_USDC_TOKEN_ID"];
    if (
      apiKey !== undefined &&
      walletId !== undefined &&
      tokenId !== undefined &&
      apiKey.length > 0 &&
      walletId.length > 0 &&
      tokenId.length > 0
    ) {
      const baseUrl = env["CIRCLE_API_BASE_URL"];
      const wallets = createWalletsClient({
        apiKey,
        ...(baseUrl !== undefined && baseUrl.length > 0 ? { baseUrl } : {}),
      });
      return new CircleSettlementProvider({ wallets, walletId, tokenId });
    }
  }
  return new LocalSettlementProvider();
}
