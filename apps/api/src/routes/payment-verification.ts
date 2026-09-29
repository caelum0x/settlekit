/**
 * Shared on-chain verification rules for the payment routes.
 *
 * Invariants enforced here (both confirm and observe go through them):
 *   - FAIL CLOSED: a network with no registered verifier can never confirm a
 *     payment. A tx hash alone is never evidence of payment.
 *   - A transaction hash settles at most ONE payment (global uniqueness), so a
 *     single on-chain transfer cannot be replayed across sessions or orgs.
 *   - EVM hashes are case-insensitive and normalized to lowercase. Only EVM
 *     networks (arc, base, ethereum) are supported; anything else is rejected.
 */
import { conflict, validationError, type Payment, type PaymentNetwork } from "@settlekit/common";
import { X402_SCHEME, type PaymentRequirements, type PaymentVerifier } from "@settlekit/x402";
import type { AppContext } from "../context.js";

/** Canonical storage form of a tx hash on `network`. */
export function normalizeTxHash(_network: PaymentNetwork, txHash: string): string {
  return txHash.trim().toLowerCase();
}

/** The verifier for `network`, or a validation error (fail closed). */
export function requireVerifier(ctx: AppContext, network: PaymentNetwork): PaymentVerifier {
  const verifier = ctx.verifiers[network];
  if (!verifier) {
    throw validationError(
      `on-chain verification is not configured for network "${network}"; payments on it cannot be confirmed`,
      { network },
    );
  }
  return verifier;
}

/**
 * Throw 409 when `txHash` already backs a different payment. Returns the
 * existing payment when it is `self` (idempotent re-confirm) or null.
 */
export async function assertTxHashUnused(
  ctx: AppContext,
  txHash: string,
  selfPaymentId?: string,
): Promise<Payment | null> {
  const existing = await ctx.payments.findByTxHash(txHash);
  if (existing === null) return null;
  if (selfPaymentId !== undefined && existing.id === selfPaymentId) return existing;
  throw conflict("transaction hash already used by another payment", {
    txHash,
    paymentId: existing.id,
  });
}

export interface OnChainCheck {
  network: PaymentNetwork;
  txHash: string;
  /** Decimal major-unit amount that must have been received. */
  amount: string;
  asset: string;
  payTo: string;
  from?: string;
  resource: string;
}

/** Verify a transfer on-chain through the network's verifier; throws on failure. */
export async function verifyOnChainOrThrow(ctx: AppContext, check: OnChainCheck): Promise<void> {
  const verifier = requireVerifier(ctx, check.network);
  const requirements: PaymentRequirements = {
    scheme: X402_SCHEME,
    amount: check.amount,
    // Verifiers widen asset to string at runtime (EURC/USYC on Arc).
    asset: check.asset as "USDC",
    network: check.network,
    payTo: check.payTo,
    productId: "",
    resource: check.resource,
    nonce: "",
  };
  const verification = await verifier(
    { txHash: check.txHash, from: check.from ?? "", amount: check.amount, network: check.network, nonce: "" },
    requirements,
  );
  if (!verification.ok) {
    throw validationError(`on-chain payment verification failed: ${verification.reason ?? "unverified"}`, {
      network: check.network,
      txHash: check.txHash,
    });
  }
}
