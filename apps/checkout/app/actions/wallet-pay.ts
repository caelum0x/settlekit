"use server";

/**
 * Server Action wrapping the offline "Pay with wallet" send. Keeps
 * @settlekit/app-kit + {@link LocalAppKitSdk} on the server so they never enter
 * the client bundle. Validates inputs at the boundary and returns a plain,
 * serializable result the client component can render directly.
 */

import { payWithWallet } from "@/lib/wallet-pay";
import type { SupportedChain } from "@settlekit/app-kit";

/** Plain, serializable result returned to the client component. */
export interface WalletPayActionResult {
  ok: boolean;
  txHash?: string;
  explorerUrl?: string;
  operation?: string;
  error?: string;
}

/** Decimal amount, up to 6 fractional digits, mirroring app-kit's validator. */
const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

/** Chains the checkout wallet-pay demo accepts. */
const ALLOWED_CHAINS: readonly SupportedChain[] = ["Arc_Testnet", "Arc_Mainnet"];

/**
 * Execute a simulated wallet payment. All inputs are validated here (never trust
 * the caller). Errors are returned as friendly strings — this action never
 * throws across the boundary.
 */
export async function payWithWalletAction(input: {
  amount: string;
  to: string;
  chain: SupportedChain;
}): Promise<WalletPayActionResult> {
  const amount = (input.amount ?? "").trim();
  const to = (input.to ?? "").trim();
  const chain = input.chain;

  if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) {
    return { ok: false, error: "Invalid order amount for wallet payment." };
  }
  if (to.length === 0) {
    return { ok: false, error: "Missing recipient address for wallet payment." };
  }
  if (!ALLOWED_CHAINS.includes(chain)) {
    return { ok: false, error: `Unsupported chain: ${String(chain)}.` };
  }

  try {
    const receipt = await payWithWallet({ amount, to, chain });
    return {
      ok: true,
      txHash: receipt.txHash,
      explorerUrl: receipt.explorerUrl,
      operation: receipt.operation,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Wallet payment could not be completed.";
    return { ok: false, error: message };
  }
}
