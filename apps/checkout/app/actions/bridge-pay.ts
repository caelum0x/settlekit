"use server";

/**
 * Server Action wrapping the offline crosschain bridge-to-Arc payment. Keeps
 * @settlekit/app-kit on the server; validates inputs and returns a plain result.
 */

import { bridgeToArc, BRIDGE_SOURCE_CHAINS } from "@/lib/bridge-pay";
import type { SupportedChain } from "@settlekit/app-kit";

export interface BridgePayActionResult {
  ok: boolean;
  txHash?: string;
  explorerUrl?: string;
  fromChain?: string;
  error?: string;
}

const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

export async function bridgePayAction(input: {
  amount: string;
  fromChain: SupportedChain;
}): Promise<BridgePayActionResult> {
  const amount = (input.amount ?? "").trim();
  if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) {
    return { ok: false, error: "Invalid order amount." };
  }
  if (!BRIDGE_SOURCE_CHAINS.includes(input.fromChain)) {
    return { ok: false, error: `Unsupported source chain: ${String(input.fromChain)}.` };
  }
  try {
    const receipt = await bridgeToArc({ amount, fromChain: input.fromChain });
    return {
      ok: true,
      txHash: receipt.txHash,
      explorerUrl: receipt.explorerUrl,
      fromChain: receipt.fromChain,
    };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Bridge failed." };
  }
}
