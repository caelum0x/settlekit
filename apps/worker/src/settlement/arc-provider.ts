/**
 * Live Arc settlement provider factory (viem-backed).
 *
 * This is the "go live on Arc" seam for the worker: it builds a viem-backed
 * App Kit client over the configured settler key (`@settlekit/app-kit-viem`),
 * wraps it with {@link configureAppKit}, and returns an
 * {@link ArcSettlementProvider} the Lepton settlement jobs use to move real USDC
 * on Arc — replacing the no-op `local` provider.
 *
 * Construction is fully offline: the viem account + wallet client are lazy and
 * never touch the RPC; only a later `settle()` submits a transaction. Any
 * construction failure is caught, logged via the worker {@link Logger}, and
 * turned into `null` so a misconfigured `arc` selection falls back to local
 * rather than crashing boot. The private key value is never logged.
 */

import { ArcSettlementProvider, configureAppKit } from "@settlekit/app-kit";
import { createViemAppKitSdk, resolveAccount } from "@settlekit/app-kit-viem";
import type { Account } from "viem";
import type { SettlementProvider } from "@settlekit/settlement-core";
import type { ArcSettlementConfig } from "../config.js";
import { errorMessage, type Logger } from "../logger.js";

/**
 * Arc Testnet EVM chain id. `@settlekit/arc-chains` currently carries a `0`
 * sentinel for Arc, which viem cannot sign against, so the live settler pins the
 * real chain id here. Confirm against the deployed network before mainnet use.
 */
const ARC_TESTNET_CHAIN_ID = 5042002;

/**
 * Build the live viem-backed Arc settlement provider, or `null` when it cannot
 * be assembled (the runtime then falls back to the local provider).
 */
export function createArcSettlementProvider(
  config: ArcSettlementConfig,
  logger: Logger,
): SettlementProvider | null {
  try {
    const privateKey = config.privateKey as `0x${string}`;
    const sdk = createViemAppKitSdk<Account>({
      privateKey,
      rpcUrl: config.rpcUrl,
      chainId: ARC_TESTNET_CHAIN_ID,
    });
    const account = resolveAccount({ privateKey, rpcUrl: config.rpcUrl });
    const client = configureAppKit<Account>({
      sdk,
      ...(config.circleKitKey !== undefined ? { kitKey: config.circleKitKey } : {}),
    });
    return new ArcSettlementProvider<Account>({
      client,
      adapter: account,
      chains: "testnet",
    });
  } catch (error) {
    logger.warn("failed to build Arc settlement provider; falling back to local", {
      error: errorMessage(error),
    });
    return null;
  }
}
