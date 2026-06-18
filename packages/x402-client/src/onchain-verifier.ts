/**
 * A production x402 {@link PaymentVerifier} that confirms the presented proof
 * against on-chain state via the Arc indexer — the resource only serves content
 * once the USDC transfer is real, to the right address, for the right amount,
 * and sufficiently confirmed.
 */

import { compareMoney, money } from "@settlekit/common";
import type { PaymentProof, PaymentRequirements, PaymentVerifier, VerifyResult } from "@settlekit/x402";
import type { IndexerClient } from "./indexer-client.js";

/** Options for {@link createOnchainVerifier}. */
export interface OnchainVerifierOptions {
  indexer: IndexerClient;
  /** Required confirmations before a payment is accepted. Default 1. */
  minConfirmations?: number;
}

/** Build an indexer-backed x402 verifier. */
export function createOnchainVerifier(options: OnchainVerifierOptions): PaymentVerifier {
  const minConfirmations = options.minConfirmations ?? 1;
  return async (proof: PaymentProof, requirements: PaymentRequirements): Promise<VerifyResult> => {
    const transfer = await options.indexer.getTransfer(proof.txHash);
    if (transfer === null) {
      return { ok: false, reason: "transfer not found on chain" };
    }
    if (transfer.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return { ok: false, reason: "recipient mismatch" };
    }
    if (transfer.network !== requirements.network) {
      return { ok: false, reason: "network mismatch" };
    }
    if (compareMoney(money(transfer.amountUsdc), money(requirements.amount)) < 0) {
      return { ok: false, reason: "underpaid" };
    }
    if (transfer.confirmations < minConfirmations) {
      return { ok: false, reason: "insufficient confirmations" };
    }
    return { ok: true };
  };
}
