/**
 * Adapter from Solana USDC verification to the legacy `@settlekit/x402`
 * {@link PaymentVerifier} contract (tx-hash proof), so the API's per-network
 * verifier registry can confirm Solana payments exactly like Arc/Base ones.
 *
 * When the requirements carry a Solana Pay `reference` (checkout sessions
 * do), the transaction must include it: that binds the transfer to one
 * session so an unrelated payment to the same merchant cannot be replayed.
 */

import { toBaseUnits } from "@settlekit/common";
import type { PaymentRequirements, PaymentVerifier } from "@settlekit/x402";
import type { SolanaFinality } from "./clusters.js";
import type { SolanaRpc } from "./rpc.js";
import { isSolanaAddress, isSolanaSignature } from "./validate.js";
import { verifySplTransfer } from "./verify.js";

/** x402 requirements optionally carrying the session's Solana Pay reference. */
export type SolanaPaymentRequirements = PaymentRequirements & { reference?: string };

export interface SolanaPaymentVerifierOptions {
  rpc: SolanaRpc;
  /** USDC mint for the configured cluster. */
  mint: string;
  commitment?: SolanaFinality;
}

function readReference(requirements: PaymentRequirements): string | undefined {
  const candidate = (requirements as SolanaPaymentRequirements).reference;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

export function createSolanaPaymentVerifier(options: SolanaPaymentVerifierOptions): PaymentVerifier {
  return async (proof, requirements) => {
    if (proof.network !== "solana" || requirements.network !== "solana") {
      return { ok: false, reason: `Unsupported network: ${proof.network}` };
    }
    if (!isSolanaSignature(proof.txHash)) {
      return { ok: false, reason: "Malformed Solana transaction signature" };
    }
    if (!isSolanaAddress(requirements.payTo)) {
      return { ok: false, reason: "Malformed Solana payTo address" };
    }
    // Widen: requirements.asset is typed "USDC" but arrives from callers at runtime.
    const asset: string = requirements.asset;
    if (asset !== "USDC") {
      return { ok: false, reason: `Unsupported settlement asset on Solana: ${asset}` };
    }

    let minAmount: bigint;
    try {
      minAmount = toBaseUnits(requirements.amount);
    } catch {
      return { ok: false, reason: `Invalid amount: ${requirements.amount}` };
    }

    const reference = readReference(requirements);
    const result = await verifySplTransfer(options.rpc, {
      signature: proof.txHash,
      mint: options.mint,
      recipientOwner: requirements.payTo,
      minAmount,
      ...(reference !== undefined ? { reference } : {}),
      commitment: options.commitment ?? "confirmed",
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.message };
  };
}
