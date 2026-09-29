/**
 * Per-network on-chain verification for checkout payments.
 *
 * Every check runs against the CHECKOUT SESSION (merchant payTo, invoiced
 * amount, and on Solana the session's Solana Pay reference) — never against
 * anything the buyer supplied beyond the transaction hash itself.
 *
 * FAIL CLOSED: a network without a configured verifier (Arc without RPC,
 * Solana without SOLANA_CLUSTER, Base/Ethereum which the checkout cannot read)
 * always yields `ok: false`.
 */
import { money, toBaseUnits, type CheckoutSession } from "@settlekit/common";
import { isSolanaSignature, verifySplTransfer } from "@settlekit/solana";

import type { OnChainVerification, verifyOnChainPayment } from "./arc";
import type { SolanaRuntimeResult } from "./solana";

export interface VerifyDeps {
  /** Solana runtime or the reason it is unavailable. */
  solana: SolanaRuntimeResult;
  /** Arc verifier (fails closed itself when Arc is unconfigured). */
  verifyArc: typeof verifyOnChainPayment;
}

function failed(reason: string): OnChainVerification {
  return { ok: false, confirmations: 0, minConfirmations: 1, reason };
}

async function verifySolana(
  deps: VerifyDeps,
  session: CheckoutSession,
  signature: string,
): Promise<OnChainVerification> {
  if (!deps.solana.ok) return failed(deps.solana.error);
  if (!isSolanaSignature(signature)) return failed("Malformed Solana transaction signature.");
  // The reference binds one on-chain transfer to one session; without it any
  // unrelated payment of the same amount to the merchant could be replayed.
  if (session.paymentReference === undefined) {
    return failed("This Solana checkout session has no payment reference and cannot be verified.");
  }
  const { config, rpc } = deps.solana.runtime;
  const result = await verifySplTransfer(rpc, {
    signature,
    mint: config.usdcMint,
    recipientOwner: session.payToAddress,
    minAmount: toBaseUnits(session.amount.amount),
    reference: session.paymentReference,
    commitment: config.commitment,
  });
  if (!result.ok) return failed(result.message);
  // Solana has no confirmation depth: reaching the configured commitment
  // (supermajority vote or finalization) is the single confirmation.
  return { ok: true, confirmations: 1, minConfirmations: 1 };
}

/** Verify `txHash` settles `session` on the session's network. */
export async function verifySessionPayment(
  deps: VerifyDeps,
  session: CheckoutSession,
  txHash: string,
): Promise<OnChainVerification> {
  switch (session.network) {
    case "solana":
      return verifySolana(deps, session, txHash);
    case "arc":
      return deps.verifyArc({
        txHash,
        payTo: session.payToAddress,
        amount: money(session.amount.amount, session.amount.currency),
      });
    case "base":
    case "ethereum":
      return failed(`On-chain verification for ${session.network} is not available on this checkout.`);
  }
}
