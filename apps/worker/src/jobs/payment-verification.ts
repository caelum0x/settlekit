/**
 * Per-network on-chain verification for the payment-confirm job.
 *
 * Every check is made against the payment's CHECKOUT SESSION — its payTo for
 * the payment's network, creation time, declared payer, id (Tempo memo),
 * Solana Pay reference and locked Zcash quote — never against a token
 * contract or anything the payer supplied. Networks the worker cannot verify
 * (not enabled) are reported as `unsupported` and the payment stays pending:
 * the worker fails closed. Late Zcash payments go to manual `review`.
 */

import { toBaseUnits, type CheckoutSession, type Payment, type PaymentNetwork } from "@settlekit/common";
import { isEvmChainKey, parseTxHash, type EvmChainKey } from "@settlekit/chains";
import { isSolanaSignature, verifySplTransfer } from "@settlekit/solana";
import { verifyZcashTransparent } from "@settlekit/zcash";
import type { JobContext } from "./types.js";

export type PaymentVerification =
  | { status: "confirmed"; confirmations: number; minConfirmations: number }
  | { status: "pending"; reason: string; confirmations?: number }
  | { status: "review"; reason: string }
  | { status: "unsupported"; reason: string };

/** The address `session` must be paid at on `network`. */
export function sessionPayTo(session: CheckoutSession, network: PaymentNetwork): string {
  return session.payToByNetwork?.[network] ?? session.payToAddress;
}

async function verifyEvm(
  ctx: JobContext,
  key: EvmChainKey,
  payment: Payment,
  txHash: string,
  session: CheckoutSession,
): Promise<PaymentVerification> {
  const verifier = ctx.evm[key];
  if (!verifier) return { status: "unsupported", reason: `${key} verification not enabled (ENABLED_EVM_CHAINS)` };
  const hash = parseTxHash(key, txHash);
  if (hash === null) return { status: "pending", reason: "tx hash is not a 0x 32-byte hash" };
  const result = await verifier.verify({
    txHash: hash,
    payTo: sessionPayTo(session, key),
    expectedBase: toBaseUnits(payment.amount.amount),
    notBefore: new Date(session.createdAt),
    sessionId: session.id,
    ...(session.payerAddress !== undefined ? { payer: session.payerAddress } : {}),
  });
  if (!result.ok) return { status: "pending", reason: result.reason, confirmations: result.confirmations };
  return { status: "confirmed", confirmations: result.confirmations, minConfirmations: verifier.minConfirmations };
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
    recipientOwner: sessionPayTo(session, "solana"),
    minAmount: toBaseUnits(payment.amount.amount),
    ...(session.paymentReference !== undefined ? { reference: session.paymentReference } : {}),
    commitment: "confirmed",
  });
  if (!result.ok) return { status: "pending", reason: result.message };
  // "confirmed" commitment = supermajority-voted; Solana has no depth count.
  return { status: "confirmed", confirmations: 1, minConfirmations: 1 };
}

async function verifyZcash(ctx: JobContext, txHash: string, session: CheckoutSession): Promise<PaymentVerification> {
  if (!ctx.zcash) return { status: "unsupported", reason: "Zcash verification not enabled (ZCASH_ENABLED)" };
  const quote = session.settlementQuote;
  if (quote === undefined) return { status: "unsupported", reason: "session has no locked ZEC quote" };
  const result = await verifyZcashTransparent(ctx.zcash.explorer, {
    txid: txHash,
    payTo: sessionPayTo(session, "zcash"),
    expectedZats: BigInt(quote.amountBase),
    minConfirmations: ctx.zcash.minConfirmations,
    notBefore: new Date(session.createdAt),
    quoteExpiresAt: new Date(quote.expiresAt),
    ...(session.payerAddress !== undefined ? { payer: session.payerAddress } : {}),
  });
  switch (result.status) {
    case "confirmed":
      return { status: "confirmed", confirmations: result.confirmations, minConfirmations: ctx.zcash.minConfirmations };
    case "late":
      return { status: "review", reason: result.reason };
    case "pending":
      return { status: "pending", reason: result.reason, confirmations: result.confirmations };
    case "rejected":
      return { status: "pending", reason: result.reason };
  }
}

/** Verify `payment` (carrying `txHash`) against its checkout `session`. */
export async function verifyPaymentOnChain(
  ctx: JobContext,
  payment: Payment,
  txHash: string,
  session: CheckoutSession,
): Promise<PaymentVerification> {
  const accepted = session.acceptedNetworks ?? [session.network];
  if (!accepted.includes(payment.network)) {
    return { status: "pending", reason: `network mismatch: session accepts ${accepted.join(", ")}, payment ${payment.network}` };
  }
  if (payment.network === "solana") return verifySolana(ctx, payment, txHash, session);
  if (payment.network === "zcash") return verifyZcash(ctx, txHash, session);
  if (isEvmChainKey(payment.network)) return verifyEvm(ctx, payment.network, payment, txHash, session);
  return { status: "unsupported", reason: `unknown network ${payment.network}` };
}
