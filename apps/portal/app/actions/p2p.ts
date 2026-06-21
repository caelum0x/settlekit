"use server";

/**
 * Server Action wrapping the offline P2P send. Keeps @settlekit/app-kit +
 * LocalAppKitSdk on the server (never in the client bundle), validates inputs
 * at the boundary, and returns a plain serializable result the client renders.
 */

import { sendP2P } from "@/lib/p2p";
import type { SupportedChain } from "@settlekit/app-kit";

export interface P2PActionResult {
  ok: boolean;
  txHash?: string;
  explorerUrl?: string;
  operation?: string;
  error?: string;
}

const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;
const ALLOWED_CHAINS: readonly SupportedChain[] = ["Arc_Testnet", "Arc_Mainnet"];

export async function sendP2PAction(input: {
  amount: string;
  to: string;
  chain: SupportedChain;
}): Promise<P2PActionResult> {
  const amount = (input.amount ?? "").trim();
  const to = (input.to ?? "").trim();
  const chain = input.chain;

  if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) {
    return { ok: false, error: "Enter a valid amount (USDC, up to 6 decimals)." };
  }
  if (to.length === 0) {
    return { ok: false, error: "Enter a recipient address." };
  }
  if (!ALLOWED_CHAINS.includes(chain)) {
    return { ok: false, error: `Unsupported chain: ${String(chain)}.` };
  }

  try {
    const receipt = await sendP2P({ amount, to, chain });
    return {
      ok: true,
      txHash: receipt.txHash,
      explorerUrl: receipt.explorerUrl,
      operation: receipt.operation,
    };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Send failed." };
  }
}
