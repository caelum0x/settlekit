/**
 * Server-only P2P "send USDC on Arc" helper. Builds an {@link ArcPaymentClient}
 * from @settlekit/app-kit and runs an Arc USDC `send` to a recipient.
 *
 * Offline + deterministic: it injects {@link LocalAppKitSdk}, an in-memory SDK
 * returning synthetic, monotonically-numbered tx hashes. No secrets needed —
 * `send` requires no kit key. Pattern mirrors apps/checkout/lib/wallet-pay.ts.
 *
 * SWAP TO LIVE (viem backend), in this module only:
 *   import { createViemAppKitSdk } from "@settlekit/app-kit-viem";
 *   const client = configureAppKit<string>({ sdk: createViemAppKitSdk({ privateKey, rpcUrl }) });
 * — or @circle-fin/app-kit (`new AppKit()`) + @settlekit/app-kit-viem's
 *   createCircleViemAdapterFromProvider for a browser wallet. The action +
 *   component below consume the same normalized {@link P2PReceipt}.
 */

import {
  configureAppKit,
  LocalAppKitSdk,
  type ArcPaymentClient,
  type SupportedChain,
} from "@settlekit/app-kit";

const LOCAL_ADAPTER = "local-wallet";

/** Normalized, serializable outcome of a P2P send. */
export interface P2PReceipt {
  status: "success" | "pending" | "failed";
  txHash: string;
  explorerUrl: string;
  operation: string;
}

/** Inputs for a P2P send. */
export interface SendParams {
  amount: string;
  to: string;
  chain: SupportedChain;
}

/** Build the offline P2P client. */
export function createP2PClient(): ArcPaymentClient<string> {
  return configureAppKit<string>({ sdk: new LocalAppKitSdk() });
}

/** Run an Arc USDC send and return a normalized receipt (never throws Result). */
export async function sendP2P(params: SendParams): Promise<P2PReceipt> {
  const client = createP2PClient();
  const result = await client.send({
    adapter: LOCAL_ADAPTER,
    chain: params.chain,
    to: params.to,
    amount: params.amount,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  const { status, txHash, explorerUrl, operation } = result.value;
  if (txHash === undefined || explorerUrl === undefined) {
    throw new Error("P2P send did not return a transaction.");
  }
  return { status, txHash, explorerUrl, operation: operation ?? "transfer" };
}
