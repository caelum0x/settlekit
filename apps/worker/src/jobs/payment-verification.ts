/**
 * Per-network on-chain verification for the payment-confirm job.
 *
 * Every check is made against the payment's CHECKOUT SESSION — the merchant
 * payTo address — never against a token contract or anything the payer supplied. Networks the worker
 * cannot verify (no reader configured) are reported as `unsupported` and the
 * payment stays pending: the worker fails closed.
 */

import type { CheckoutSession, Payment } from "@settlekit/common";
import type { Hex } from "@settlekit/arc";
import type { JobContext } from "./types.js";

export type PaymentVerification =
  | { status: "confirmed"; confirmations: number; minConfirmations: number }
  | { status: "pending"; reason: string; confirmations?: number }
  | { status: "unsupported"; reason: string };

function isEvmTxHash(value: string): value is Hex {
  return /^0x[a-fA-F0-9]+$/.test(value);
}

async function verifyArc(
  ctx: JobContext,
  payment: Payment,
  txHash: string,
  session: CheckoutSession,
): Promise<PaymentVerification> {
  if (!isEvmTxHash(txHash)) return { status: "pending", reason: "tx hash is not a 0x hash" };
  const minConfirmations = ctx.config.arc.minConfirmations;
  const result = await ctx.arc.verifyUsdcTransfer({
    txHash,
    to: session.payToAddress as Hex,
    minAmount: payment.amount,
  });
  if (!result.confirmed) {
    return { status: "pending", reason: "no matching USDC transfer yet", confirmations: result.confirmations };
  }
  if (result.confirmations < minConfirmations) {
    return { status: "pending", reason: "awaiting confirmations", confirmations: result.confirmations };
  }
  return { status: "confirmed", confirmations: result.confirmations, minConfirmations };
}

/** Verify `payment` (carrying `txHash`) against its checkout `session`. */
export async function verifyPaymentOnChain(
  ctx: JobContext,
  payment: Payment,
  txHash: string,
  session: CheckoutSession,
): Promise<PaymentVerification> {
  if (session.network !== payment.network) {
    return { status: "pending", reason: `network mismatch: session ${session.network}, payment ${payment.network}` };
  }
  switch (payment.network) {
    case "arc":
      return verifyArc(ctx, payment, txHash, session);
    case "base":
    case "ethereum":
      return { status: "unsupported", reason: `no ${payment.network} verifier in the worker` };
    default:
      // Unknown networks (e.g. legacy "solana" rows) are never verifiable here.
      return { status: "unsupported", reason: `unsupported network "${String(payment.network)}"` };
  }
}
