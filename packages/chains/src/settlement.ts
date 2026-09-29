/**
 * The network-agnostic settlement verifier contract used by the API's
 * per-network registry, plus adapters for EVM chains and Zcash.
 *
 * It mirrors the legacy x402 `(proof, requirements)` shape so existing
 * verifiers (Solana) adapt trivially, but carries every PaymentNetwork and
 * the session bindings the rules need (notBefore, payer, session id, quote).
 */

import { toBaseUnits, type PaymentNetwork, type SettlementQuote } from "@settlekit/common";
import { verifyZcashTransparent, type ZcashExplorer } from "@settlekit/zcash";
import type { EvmVerifier } from "./evm-verifier.js";

export interface SettlementProof {
  txHash: string;
  from: string;
  amount: string;
  network: PaymentNetwork;
  nonce: string;
}

export interface SettlementRequirements {
  scheme: string;
  /** Decimal major-unit USD amount owed. */
  amount: string;
  /** "USDC" means USD-denominated (settled in the chain's USD stablecoin). */
  asset: string;
  network: PaymentNetwork;
  payTo: string;
  productId: string;
  resource: string;
  nonce: string;
  /** Solana Pay reference (Solana only). */
  reference?: string;
  /** ISO time: the payment must not predate this (session createdAt). */
  notBefore?: string;
  /** Declared payer address (payer binding). */
  payer?: string;
  /** Checkout session id (Tempo memo binding). */
  sessionId?: string;
  /** Locked quote (Zcash). */
  settlementQuote?: SettlementQuote;
}

export interface SettlementResult {
  ok: boolean;
  reason?: string;
  /** True when the same tx may verify later (unmined, few confirmations, explorer throttled). */
  retryable?: boolean;
  /** True when the payment arrived after its quote expired (manual review). */
  late?: boolean;
  confirmations?: number;
}

export type SettlementVerifier = (
  proof: SettlementProof,
  requirements: SettlementRequirements,
) => Promise<SettlementResult>;

function parseNotBefore(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Wrap EVM verifiers for one chain. `extraAssets` maps non-default asset
 * symbols (e.g. Arc EURC/USYC) to verifiers bound to those tokens.
 */
export function createEvmSettlementVerifier(
  primary: EvmVerifier,
  extraAssets: Readonly<Record<string, EvmVerifier>> = {},
): SettlementVerifier {
  const key = primary.spec.key;
  return async (proof, requirements) => {
    if (proof.network !== key || requirements.network !== key) {
      return { ok: false, reason: `Unsupported network: ${proof.network}` };
    }
    const usd = requirements.asset === "USDC" || requirements.asset === primary.spec.token.symbol;
    const verifier = usd ? primary : extraAssets[requirements.asset];
    if (verifier === undefined) {
      return { ok: false, reason: `Unsupported settlement asset on ${key}: ${requirements.asset}` };
    }
    let expectedBase: bigint;
    try {
      expectedBase = toBaseUnits(requirements.amount);
    } catch {
      return { ok: false, reason: `Invalid amount: ${requirements.amount}` };
    }
    const notBefore = parseNotBefore(requirements.notBefore);
    const result = await verifier.verify({
      txHash: proof.txHash,
      payTo: requirements.payTo,
      expectedBase,
      ...(notBefore ? { notBefore } : {}),
      ...(requirements.payer ? { payer: requirements.payer } : {}),
      ...(requirements.sessionId ? { sessionId: requirements.sessionId } : {}),
    });
    return result.ok
      ? { ok: true, confirmations: result.confirmations }
      : { ok: false, reason: result.reason, retryable: result.retryable, confirmations: result.confirmations };
  };
}

export interface ZcashSettlementOptions {
  explorer: ZcashExplorer;
  minConfirmations: number;
}

/** Verify transparent Zcash payments against the session's locked quote. */
export function createZcashSettlementVerifier(options: ZcashSettlementOptions): SettlementVerifier {
  return async (proof, requirements) => {
    if (proof.network !== "zcash" || requirements.network !== "zcash") {
      return { ok: false, reason: `Unsupported network: ${proof.network}` };
    }
    const quote = requirements.settlementQuote;
    if (quote === undefined) return { ok: false, reason: "session has no locked ZEC quote" };
    const notBefore = parseNotBefore(requirements.notBefore) ?? new Date(quote.lockedAt);
    const result = await verifyZcashTransparent(options.explorer, {
      txid: proof.txHash,
      payTo: requirements.payTo,
      expectedZats: BigInt(quote.amountBase),
      minConfirmations: options.minConfirmations,
      notBefore,
      quoteExpiresAt: new Date(quote.expiresAt),
      ...(requirements.payer ? { payer: requirements.payer } : {}),
    });
    switch (result.status) {
      case "confirmed":
        return { ok: true, confirmations: result.confirmations };
      case "pending":
        return { ok: false, reason: result.reason, retryable: true, confirmations: result.confirmations };
      case "late":
        return { ok: false, reason: result.reason, late: true, confirmations: result.confirmations };
      case "rejected":
        return { ok: false, reason: result.reason };
    }
  };
}

export interface ChainIdCheck {
  key: string;
  ok: boolean;
  error?: string;
}

/** Assert every verifier's RPC serves its configured chain (boot check). */
export async function checkEvmChainIds(verifiers: readonly EvmVerifier[]): Promise<ChainIdCheck[]> {
  return Promise.all(
    verifiers.map(async (verifier) => {
      try {
        await verifier.assertChainId();
        return { key: verifier.spec.key, ok: true };
      } catch (error) {
        return { key: verifier.spec.key, ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}
