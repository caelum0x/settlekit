/**
 * Per-network on-chain verification for the payment-confirm job.
 *
 * Every check is made against the payment's CHECKOUT SESSION — the merchant
 * payTo address (and, on Solana, the session's Solana Pay reference) — never
 * against a token contract or anything the payer supplied. Networks the worker
 * cannot verify (no reader configured) are reported as `unsupported` and the
 * payment stays pending: the worker fails closed.
 */

import { toBaseUnits, type CheckoutSession, type Payment } from "@settlekit/common";
import type { Hex } from "@settlekit/arc";
import { isSolanaSignature, verifySplTransfer } from "@settlekit/solana";
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

async function verifySolana(
  ctx: JobContext,
  payment: Payment,
  txHash: string,
  session: CheckoutSession,
): Promise<PaymentVerification> {
  if (!ctx.solana) return { status: "unsupported", reason: "Solana verification not configured (SOLANA_CLUSTER)" };
  if (!isSolanaSignature(txHash)) return { status: "pending", reason: "tx hash is not a Solana signature" };
  const result = await verifySplTransfer(ctx.solana.rpc, {
    signature: txHash,
    mint: ctx.solana.usdcMint,
    recipientOwner: session.payToAddress,
    minAmount: toBaseUnits(payment.amount.amount),
    ...(session.paymentReference !== undefined ? { reference: session.paymentReference } : {}),
    commitment: "confirmed",
  });
  if (!result.ok) return { status: "pending", reason: result.message };
  // "confirmed" commitment = supermajority-voted; Solana has no depth count.
  return { status: "confirmed", confirmations: 1, minConfirmations: 1 };
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
    case "solana":
      return verifySolana(ctx, payment, txHash, session);
    case "base":
    case "ethereum":
      return { status: "unsupported", reason: `no ${payment.network} verifier in the worker` };
  }
}
