/**
 * Shared on-chain verification rules for the payment routes.
 *
 * Invariants enforced here (both confirm and observe go through them):
 *   - FAIL CLOSED: a network with no registered verifier can never confirm a
 *     payment. A tx hash alone is never evidence of payment.
 *   - A transaction hash settles at most ONE payment (global uniqueness), so a
 *     single on-chain transfer cannot be replayed across sessions or orgs.
 *   - Tx ids are validated and normalized per network (@settlekit/chains):
 *     EVM and Zcash lowercase, Solana signatures verbatim.
 *   - Session bindings travel to the verifier: payTo for the network, the
 *     session creation time (block time must not predate it), the declared
 *     payer, the session id (Tempo memo) and the locked Zcash quote.
 */
import {
  conflict,
  validationError,
  type CheckoutSession,
  type Payment,
  type PaymentNetwork,
  type SettlementQuote,
} from "@settlekit/common";
import { normalizeTxHash as normalizeFill, parseTxHash, txHashFormatHint, type SettlementVerifier } from "@settlekit/chains";
import { X402_SCHEME } from "@settlekit/x402";
import type { AppContext } from "../context.js";

export { normalizeTxHash } from "@settlekit/chains";

/** Validate + normalize `txHash` for `network`, or throw a 400. */
export function requireTxHash(network: PaymentNetwork, txHash: string): string {
  const parsed = parseTxHash(network, txHash);
  if (parsed === null) {
    throw validationError(`txHash must be ${txHashFormatHint(network)} for network ${network}`, { network });
  }
  return parsed;
}

/** The verifier for `network`, or a validation error (fail closed). */
export function requireVerifier(ctx: AppContext, network: PaymentNetwork): SettlementVerifier {
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
  /** Solana Pay reference the transaction must include (Solana only). */
  reference?: string;
  from?: string;
  resource: string;
  /** ISO time the payment must not predate (session createdAt). */
  notBefore?: string;
  /** Declared payer address (payer binding). */
  payer?: string;
  /** Checkout session id (Tempo memo binding). */
  sessionId?: string;
  /** Tempo: only transferWithMemo carrying keccak256(sessionId) settles. */
  requireMemo?: boolean;
  /** Locked Zcash quote. */
  settlementQuote?: SettlementQuote;
}

/** The address `session` must be paid at on `network`. */
export function payToFor(session: CheckoutSession, network: PaymentNetwork): string {
  return session.payToByNetwork?.[network] ?? session.payToAddress;
}

/**
 * True when `txHash` is the destination fill an any-token route provider
 * reported for `session` (stored server-side by the checkout): the solver
 * sent it, so the payer and memo bindings do not apply.
 */
export function isRoutedFill(session: CheckoutSession, network: PaymentNetwork, txHash: string): boolean {
  const fill = session.route?.destinationTxHash;
  if (fill === undefined || session.route?.network !== network) return false;
  return normalizeFill(network, fill) === normalizeFill(network, txHash);
}

/** Build the verification check binding `txHash` to `session` on `network`. */
export function sessionCheck(session: CheckoutSession, network: PaymentNetwork, txHash: string): OnChainCheck {
  const routed = isRoutedFill(session, network, txHash);
  return {
    network,
    txHash,
    amount: session.amount.amount,
    asset: session.amount.currency,
    payTo: payToFor(session, network),
    resource: `checkout_session:${session.id}`,
    notBefore: session.createdAt,
    sessionId: session.id,
    ...(session.paymentReference !== undefined ? { reference: session.paymentReference } : {}),
    ...(session.payerAddress !== undefined && !routed ? { payer: session.payerAddress } : {}),
    ...(session.requireMemo === true && !routed ? { requireMemo: true } : {}),
    ...(session.settlementQuote !== undefined ? { settlementQuote: session.settlementQuote } : {}),
  };
}

/** Verify a transfer on-chain through the network's verifier; throws on failure. */
export async function verifyOnChainOrThrow(ctx: AppContext, check: OnChainCheck): Promise<void> {
  const verifier = requireVerifier(ctx, check.network);
  const { network, txHash, from, ...rest } = check;
  const verification = await verifier(
    { txHash, from: from ?? "", amount: check.amount, network, nonce: "" },
    { ...rest, scheme: X402_SCHEME, network, productId: "", nonce: "" },
  );
  if (verification.ok) return;
  const reason = verification.reason ?? "unverified";
  const prefix = verification.late
    ? "payment requires manual review"
    : verification.retryable
      ? "payment not yet verifiable on-chain (retry later)"
      : "on-chain payment verification failed";
  throw validationError(`${prefix}: ${reason}`, {
    network,
    txHash,
    ...(verification.retryable ? { retryable: true } : {}),
    ...(verification.late ? { manualReview: true } : {}),
  });
}
