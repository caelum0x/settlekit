/**
 * SPL-token (USDC) transfer verification from a `jsonParsed` transaction.
 *
 * Rules (never trust the buyer's claim — only the chain's balance deltas):
 *   1. The transaction exists at the requested commitment and `meta.err` is null.
 *   2. Received = Σ post − Σ pre token balances whose `mint` equals the
 *      expected mint AND whose `owner` equals the recipient wallet, in bigint
 *      base units. Balances of any other mint or owner are ignored, so a
 *      transfer of a look-alike token, or to a different wallet, counts as 0.
 *      An ATA created inside the same transaction has no pre balance and so
 *      contributes its full post balance.
 *   3. Received must be ≥ `minAmount` (no rounding, no floats).
 *   4. When a `reference` is supplied it must appear in the message's account
 *      keys (static or lookup-table loaded).
 *   5. The payer is the owner whose balance of the mint decreased the most;
 *      when `payer` is supplied it must match (mirrors the EVM verifier's
 *      payer binding — see packages/chains/src/evm-verifier.ts). Until
 *      2026-10-26 this adapter never checked it, so a checkout session with
 *      a declared `payerAddress` (the pre-authorized-wallet / recurring
 *      on-chain-billing flow) accepted payment from ANY wallet, not just the
 *      declared one.
 *   6. When `notBefore` is supplied, the transaction's block time must not
 *      predate it by more than {@link CLOCK_SKEW_MS} (mirrors the EVM
 *      verifier's `notBefore` rule). A transaction with no on-chain block
 *      time cannot satisfy this and fails closed. (The route-provider
 *      destination-fill path has its own separate notBefore check in
 *      `apps/api/src/config/verifier-registry.ts` and does not go through
 *      this parameter; this one is for ordinary checkout-session payments.)
 */

import type { SolanaFinality } from "./clusters.js";
import type { ParsedTransaction, SolanaRpc, TokenBalance } from "./rpc.js";

/** Allowed clock skew between the session's `notBefore` and the tx block time. */
export const CLOCK_SKEW_MS = 120_000;

export interface VerifySplTransferParams {
  /** Transaction signature (base58). */
  signature: string;
  /** Expected SPL mint (e.g. USDC). */
  mint: string;
  /** Wallet that must receive the tokens (owner of the destination token account). */
  recipientOwner: string;
  /** Minimum amount received, in base units. */
  minAmount: bigint;
  /** Solana Pay reference that must be present in the account keys. */
  reference?: string;
  /** Declared payer address (payer binding); the largest-decrease owner must match. */
  payer?: string;
  /** Earliest acceptable block time; the check allows {@link CLOCK_SKEW_MS} of skew. */
  notBefore?: Date;
  /** Read commitment; defaults to `"confirmed"`. */
  commitment?: SolanaFinality;
}

export type VerifySplTransferFailure =
  | "not_found"
  | "transaction_failed"
  | "no_matching_transfer"
  | "underpaid"
  | "reference_missing"
  | "payer_mismatch"
  | "too_old";

export type VerifySplTransferResult =
  | {
      ok: true;
      signature: string;
      /** Net base units the recipient gained in the expected mint. */
      received: bigint;
      /** Owner whose balance of the mint decreased most, or null if none did. */
      payer: string | null;
      slot: number;
      blockTime: number | null;
    }
  | {
      ok: false;
      reason: VerifySplTransferFailure;
      message: string;
      /** Net base units received (present when the tx was readable). */
      received?: bigint;
    };

function sumByOwner(
  balances: readonly TokenBalance[] | null | undefined,
  mint: string,
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const balance of balances ?? []) {
    if (balance.mint !== mint || balance.owner === undefined) continue;
    const amount = BigInt(balance.uiTokenAmount.amount);
    totals.set(balance.owner, (totals.get(balance.owner) ?? 0n) + amount);
  }
  return totals;
}

/** Net change per owner for `mint` across the transaction. */
export function tokenDeltasByOwner(tx: ParsedTransaction, mint: string): Map<string, bigint> {
  const pre = sumByOwner(tx.meta?.preTokenBalances, mint);
  const post = sumByOwner(tx.meta?.postTokenBalances, mint);
  const owners = new Set([...pre.keys(), ...post.keys()]);
  const deltas = new Map<string, bigint>();
  for (const owner of owners) {
    deltas.set(owner, (post.get(owner) ?? 0n) - (pre.get(owner) ?? 0n));
  }
  return deltas;
}

function largestDecrease(deltas: Map<string, bigint>): string | null {
  let payer: string | null = null;
  let lowest = 0n;
  for (const [owner, delta] of deltas) {
    if (delta < lowest) {
      lowest = delta;
      payer = owner;
    }
  }
  return payer;
}

function hasAccountKey(tx: ParsedTransaction, key: string): boolean {
  return tx.transaction.message.accountKeys.some((account) => account.pubkey === key);
}

/**
 * Pure verification over an already-fetched transaction (null = not found).
 * Exposed so callers holding a transaction (e.g. from a webhook) skip the RPC.
 */
export function evaluateSplTransfer(
  tx: ParsedTransaction | null,
  params: VerifySplTransferParams,
): VerifySplTransferResult {
  if (tx === null || tx.meta === null) {
    return { ok: false, reason: "not_found", message: `transaction ${params.signature} not found` };
  }
  if (tx.meta.err !== null && tx.meta.err !== undefined) {
    return {
      ok: false,
      reason: "transaction_failed",
      message: `transaction ${params.signature} failed on-chain: ${JSON.stringify(tx.meta.err)}`,
    };
  }

  const deltas = tokenDeltasByOwner(tx, params.mint);
  const received = deltas.get(params.recipientOwner) ?? 0n;
  if (received <= 0n) {
    return {
      ok: false,
      reason: "no_matching_transfer",
      message: `no transfer of mint ${params.mint} to ${params.recipientOwner}`,
      received,
    };
  }
  if (received < params.minAmount) {
    return {
      ok: false,
      reason: "underpaid",
      message: `received ${received} base units, expected at least ${params.minAmount}`,
      received,
    };
  }
  if (params.reference !== undefined && !hasAccountKey(tx, params.reference)) {
    return {
      ok: false,
      reason: "reference_missing",
      message: `reference ${params.reference} not present in transaction`,
      received,
    };
  }

  const payer = largestDecrease(deltas);
  if (params.payer !== undefined && payer !== params.payer) {
    return {
      ok: false,
      reason: "payer_mismatch",
      message: `transfer was not sent from the declared payer ${params.payer}`,
      received,
    };
  }
  if (params.notBefore !== undefined) {
    if (tx.blockTime === null) {
      return {
        ok: false,
        reason: "too_old",
        message: "transaction has no on-chain block time; cannot verify it was not mined before the checkout session was created",
        received,
      };
    }
    if (tx.blockTime * 1000 < params.notBefore.getTime() - CLOCK_SKEW_MS) {
      return {
        ok: false,
        reason: "too_old",
        message: "transaction was mined before the checkout session was created",
        received,
      };
    }
  }

  return {
    ok: true,
    signature: params.signature,
    received,
    payer,
    slot: tx.slot,
    blockTime: tx.blockTime,
  };
}

/** Fetch `params.signature` and verify it per the module rules. */
export async function verifySplTransfer(
  rpc: SolanaRpc,
  params: VerifySplTransferParams,
): Promise<VerifySplTransferResult> {
  const tx = await rpc.getTransaction(params.signature, params.commitment ?? "confirmed");
  return evaluateSplTransfer(tx, params);
}
