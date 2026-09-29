/**
 * Per-network on-chain verification for checkout payments.
 *
 * Every check runs against the CHECKOUT SESSION (merchant payTo for the
 * session's network, invoiced amount, session creation time, declared payer,
 * Solana Pay reference, Tempo memo, locked ZEC quote) — never against
 * anything the buyer supplied beyond the transaction hash itself.
 *
 * FAIL CLOSED: the switch is exhaustive over every PaymentNetwork, and a
 * network without a configured runtime (Solana without SOLANA_CLUSTER, an
 * EVM chain missing from ENABLED_EVM_CHAINS, Zcash without ZCASH_ENABLED)
 * always yields `ok: false`.
 */
import { money, toBaseUnits, type CheckoutSession, type PaymentNetwork } from "@settlekit/common";
import type { EvmChainKey, EvmVerification } from "@settlekit/chains";
import { isSolanaSignature, verifySplTransfer } from "@settlekit/solana";

import type { OnChainVerification, verifyOnChainPayment } from "./arc";
import type { EvmRuntimeResult } from "./evm";
import type { SolanaRuntimeResult } from "./solana";
import { verifyZcashPayment, type ZcashRuntimeResult } from "./zcash";

export interface VerifyDeps {
  /** Solana runtime or the reason it is unavailable. */
  solana: SolanaRuntimeResult;
  /** Legacy Arc verifier (ARC_RPC_URL + ARC_USDC_ADDRESS); used when Arc is not in the EVM runtime. */
  verifyArc: typeof verifyOnChainPayment;
  /** Enabled EVM chains (absent = every EVM chain but legacy Arc fails closed). */
  evm?: EvmRuntimeResult;
  /** Transparent Zcash runtime (absent = Zcash fails closed). */
  zcash?: ZcashRuntimeResult;
}

function failed(reason: string, minConfirmations = 1): OnChainVerification {
  return { ok: false, confirmations: 0, minConfirmations, reason };
}

/** Where the buyer pays on `network`: per-network override, else the default payTo. */
export function payToFor(session: CheckoutSession, network: PaymentNetwork): string {
  return session.payToByNetwork?.[network] ?? session.payToAddress;
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
    recipientOwner: payToFor(session, "solana"),
    minAmount: toBaseUnits(session.amount.amount),
    reference: session.paymentReference,
    commitment: config.commitment,
  });
  if (!result.ok) return failed(result.message);
  // Solana has no confirmation depth: reaching the configured commitment
  // (supermajority vote or finalization) is the single confirmation.
  return { ok: true, confirmations: 1, minConfirmations: 1 };
}

/** Map the chains verifier outcome onto the checkout's verification shape. */
export function fromEvmVerification(result: EvmVerification, minConfirmations: number): OnChainVerification {
  if (result.ok) return { ok: true, confirmations: result.confirmations, minConfirmations };
  const base = { ok: false, confirmations: result.confirmations, minConfirmations, reason: result.reason };
  switch (result.code) {
    case "insufficient_confirmations":
      // Every other rule (token, payTo, amount, payer, memo, block time) passed.
      return { ...base, pending: true, claimable: true };
    case "not_found":
    case "rpc_unavailable":
      return { ...base, pending: true };
    default:
      return base;
  }
}

async function verifyEvm(
  deps: VerifyDeps,
  key: EvmChainKey,
  session: CheckoutSession,
  txHash: string,
): Promise<OnChainVerification | undefined> {
  const runtime = deps.evm;
  if (runtime === undefined || !runtime.ok) return undefined;
  const verifier = runtime.runtime.verifiers[key];
  if (verifier === undefined) return undefined;
  const result = await verifier.verify({
    txHash,
    payTo: payToFor(session, key),
    expectedBase: toBaseUnits(session.amount.amount),
    notBefore: new Date(session.createdAt),
    sessionId: session.id,
    ...(session.payerAddress ? { payer: session.payerAddress } : {}),
  });
  return fromEvmVerification(result, verifier.minConfirmations);
}

function evmUnavailable(deps: VerifyDeps, network: PaymentNetwork): OnChainVerification {
  if (deps.evm !== undefined && !deps.evm.ok) return failed(deps.evm.error);
  return failed(`${network} payments are not enabled on this checkout (add it to ENABLED_EVM_CHAINS).`);
}

/** Verify `txHash` settles `session` on the session's network. */
export async function verifySessionPayment(
  deps: VerifyDeps,
  session: CheckoutSession,
  txHash: string,
): Promise<OnChainVerification> {
  const network = session.network;
  switch (network) {
    case "solana":
      return verifySolana(deps, session, txHash);
    case "arc": {
      const viaRegistry = await verifyEvm(deps, "arc", session, txHash);
      if (viaRegistry !== undefined) return viaRegistry;
      // Legacy Arc settings (fails closed itself when unconfigured).
      return deps.verifyArc({
        txHash,
        payTo: payToFor(session, "arc"),
        amount: money(session.amount.amount, session.amount.currency),
      });
    }
    case "base":
    case "ethereum":
    case "arbitrum":
    case "robinhood":
    case "hyperevm":
    case "tempo":
      return (await verifyEvm(deps, network, session, txHash)) ?? evmUnavailable(deps, network);
    case "zcash":
      if (deps.zcash === undefined) return failed("Zcash payments are not enabled on this checkout.");
      if (!deps.zcash.ok) return failed(deps.zcash.error);
      return verifyZcashPayment(deps.zcash.runtime, session, txHash);
    default: {
      const unreachable: never = network;
      return failed(`Unsupported network: ${String(unreachable)}`);
    }
  }
}
