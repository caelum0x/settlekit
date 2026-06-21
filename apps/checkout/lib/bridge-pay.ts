/**
 * Server-only "pay from another chain" helper: bridges USDC from a source chain
 * to Arc for the order amount via @settlekit/app-kit's `bridge` (Gateway/CCTP
 * under the hood). Offline + deterministic via {@link LocalAppKitSdk}; mirrors
 * lib/wallet-pay.ts. Live: swap the injected SDK for @circle-fin/app-kit
 * (`new AppKit()`) — see the note in lib/wallet-pay.ts.
 */

import {
  configureAppKit,
  LocalAppKitSdk,
  type ArcPaymentClient,
  type SupportedChain,
} from "@settlekit/app-kit";

const LOCAL_ADAPTER = "local-wallet";

/** Source chains a buyer can bridge from in the checkout demo. */
export const BRIDGE_SOURCE_CHAINS: readonly SupportedChain[] = [
  "Ethereum_Sepolia",
  "Base_Sepolia",
  "Arbitrum_Sepolia",
];

/** Normalized, serializable outcome of a bridged payment. */
export interface BridgeReceipt {
  status: "success" | "pending" | "failed";
  txHash: string;
  explorerUrl: string;
  operation: string;
  fromChain: SupportedChain;
}

export interface BridgePayParams {
  amount: string;
  fromChain: SupportedChain;
}

function createClient(): ArcPaymentClient<string> {
  return configureAppKit<string>({ sdk: new LocalAppKitSdk() });
}

/** Bridge `amount` USDC from `fromChain` to Arc and return a normalized receipt. */
export async function bridgeToArc(params: BridgePayParams): Promise<BridgeReceipt> {
  const client = createClient();
  const result = await client.bridge({
    adapter: LOCAL_ADAPTER,
    fromChain: params.fromChain,
    toChain: "Arc_Testnet",
    amount: params.amount,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  const { status, txHash, explorerUrl, operation } = result.value;
  if (txHash === undefined || explorerUrl === undefined) {
    throw new Error("Bridge did not return a transaction.");
  }
  return {
    status,
    txHash,
    explorerUrl,
    operation: operation ?? "bridge",
    fromChain: params.fromChain,
  };
}
