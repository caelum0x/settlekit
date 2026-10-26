/**
 * Adapter from Solana USDC verification to the legacy `@settlekit/x402`
 * {@link PaymentVerifier} contract (tx-hash proof), so the API's per-network
 * verifier registry can confirm Solana payments exactly like Arc/Base ones.
 *
 * When the requirements carry a Solana Pay `reference` (checkout sessions
 * do), the transaction must include it: that binds the transfer to one
 * session so an unrelated payment to the same merchant cannot be replayed.
 *
 * Also forwards the `payer` and `notBefore` session bindings (present on
 * every call via `payment-verification.ts`'s `sessionCheck`, same as the EVM
 * and Zcash verifiers consume) down to `verifySplTransfer`.
 *
 * Fixed 2026-10-26: this adapter previously read neither field, so a
 * checkout session with a declared `payerAddress` (the agentic / recurring
 * on-chain-billing flow in `apps/api/src/routes/onchain-billing.ts`, which
 * pre-authorizes one wallet to pay) accepted a payment of the right amount
 * to the right address from ANY wallet, not just the declared payer — the
 * EVM and Zcash verifiers already enforced this (see
 * packages/chains/src/evm-verifier.ts and settlement.ts), only Solana did
 * not. `notBefore` is forwarded too for the same consistency, though the
 * route-provider "routedFill" path (the one case with no Solana Pay
 * reference at all) already has its own independent notBefore check in
 * `apps/api/src/config/verifier-registry.ts`'s `verifyRoutedSolanaFill`,
 * which bypasses this adapter.
 */

import { toBaseUnits } from "@settlekit/common";
import type { PaymentRequirements, PaymentVerifier } from "@settlekit/x402";
import type { SolanaFinality } from "./clusters.js";
import type { SolanaRpc } from "./rpc.js";
import { isSolanaAddress, isSolanaSignature } from "./validate.js";
import { verifySplTransfer } from "./verify.js";

/** x402 requirements optionally carrying the session's Solana Pay reference. */
export type SolanaPaymentRequirements = PaymentRequirements & {
  reference?: string;
  /** Declared payer address (payer binding). */
  payer?: string;
  /** ISO time: the payment must not predate this (session createdAt). */
  notBefore?: string;
};

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

function readPayer(requirements: PaymentRequirements): string | undefined {
  const candidate = (requirements as SolanaPaymentRequirements).payer;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

/** Parse the ISO `notBefore` requirement to a `Date`, or `undefined` if absent/invalid. */
function readNotBefore(requirements: PaymentRequirements): Date | undefined {
  const candidate = (requirements as SolanaPaymentRequirements).notBefore;
  if (typeof candidate !== "string" || candidate.length === 0) return undefined;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? undefined : date;
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
    const payer = readPayer(requirements);
    const notBefore = readNotBefore(requirements);
    const result = await verifySplTransfer(options.rpc, {
      signature: proof.txHash,
      mint: options.mint,
      recipientOwner: requirements.payTo,
      minAmount,
      ...(reference !== undefined ? { reference } : {}),
      ...(payer !== undefined ? { payer } : {}),
      ...(notBefore !== undefined ? { notBefore } : {}),
      commitment: options.commitment ?? "confirmed",
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.message };
  };
}
