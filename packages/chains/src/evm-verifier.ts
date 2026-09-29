/**
 * Generic EVM stablecoin payment verification (every chain in the registry).
 *
 * Rules, all fail closed:
 *   (a) the RPC's `eth_chainId` equals the spec's chain id;
 *   (b) the receipt exists and succeeded;
 *   (c) a Transfer from the spec's token contract pays `payTo` >= expected;
 *   (d) confirmations >= the configured minimum;
 *   (e) the block was produced no earlier than `notBefore` (session
 *       creation minus {@link CLOCK_SKEW_MS});
 *   (g) when a payer is bound, the matching transfer comes from it;
 *   (h) Tempo: a memo'd transfer must carry keccak256(sessionId); with
 *       `requireMemo` a plain (memo-less) transfer does not count either.
 * (f) global tx-hash uniqueness is enforced by the caller's payment store.
 * Extra transfers (e.g. Tempo's stablecoin fee Transfer from the payer) are
 * ignored: only transfers to `payTo` are considered.
 */

import type { ArcTransactionReceipt, FullEvmRpc } from "@settlekit/arc";
import { decodeTokenTransfers, sessionMemo, type TokenTransfer } from "./evm-logs.js";
import type { EvmChainSpec, Hex } from "./registry.js";

export const CLOCK_SKEW_MS = 120_000;

/** The RPC endpoint serves a different chain than the spec (never retryable). */
export class ChainIdMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainIdMismatchError";
  }
}

export type EvmFailureCode =
  | "chain_mismatch"
  | "rpc_unavailable"
  | "malformed"
  | "not_found"
  | "reverted"
  | "no_transfer"
  | "underpaid"
  | "insufficient_confirmations"
  | "too_old"
  | "payer_mismatch"
  | "memo_mismatch"
  | "memo_missing";

export type EvmVerification =
  | { ok: true; from: Hex; amountBase: bigint; confirmations: number; blockNumber: bigint; blockTime: Date }
  | { ok: false; code: EvmFailureCode; reason: string; retryable: boolean; confirmations: number };

export interface EvmVerifyParams {
  txHash: string;
  payTo: string;
  /** Minimum token base units (6 decimals). */
  expectedBase: bigint;
  /** Earliest acceptable time; the check allows {@link CLOCK_SKEW_MS} of skew. */
  notBefore?: Date;
  payer?: string;
  /** Session id for the Tempo memo binding. */
  sessionId?: string;
  /**
   * Tempo: only a `transferWithMemo` carrying keccak256(sessionId) counts
   * (plain transfers to payTo are ignored). Requires `sessionId`.
   */
  requireMemo?: boolean;
}

export interface EvmVerifier {
  readonly spec: EvmChainSpec;
  readonly minConfirmations: number;
  /** Throw unless the RPC serves `spec.chainId` (cached after success). */
  assertChainId(): Promise<void>;
  verify(params: EvmVerifyParams): Promise<EvmVerification>;
}

export interface EvmVerifierOptions {
  spec: EvmChainSpec;
  rpc: FullEvmRpc;
  minConfirmations?: number;
  /** Token override for non-production use (defaults to `spec.token.address`). */
  tokenAddress?: Hex;
}

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function fail(code: EvmFailureCode, reason: string, retryable = false, confirmations = 0): EvmVerification {
  return { ok: false, code, reason, retryable, confirmations };
}

function pickTransfer(
  transfers: readonly TokenTransfer[],
  params: EvmVerifyParams,
  spec: EvmChainSpec,
): TokenTransfer | EvmVerification {
  const payTo = params.payTo.toLowerCase();
  let toPayee = transfers.filter((transfer) => transfer.to === payTo);
  if (toPayee.length === 0) return fail("no_transfer", `no ${spec.token.symbol} transfer to the payTo address`);
  if (spec.key === "tempo" && params.requireMemo === true && params.sessionId === undefined) {
    return fail("memo_missing", "a memo is required but no checkout session id was supplied");
  }
  if (spec.key === "tempo" && params.sessionId !== undefined) {
    const expectedMemo = sessionMemo(params.sessionId);
    if (toPayee.some((transfer) => transfer.memo !== undefined && transfer.memo !== expectedMemo)) {
      return fail("memo_mismatch", "transfer memo does not match this checkout session");
    }
    if (params.requireMemo === true) {
      toPayee = toPayee.filter((transfer) => transfer.memo === expectedMemo);
      if (toPayee.length === 0) {
        return fail("memo_missing", "this checkout requires transferWithMemo carrying the session memo");
      }
    }
  }
  const payer = params.payer?.toLowerCase();
  const fromPayer = payer === undefined ? toPayee : toPayee.filter((transfer) => transfer.from === payer);
  if (fromPayer.length === 0) return fail("payer_mismatch", "transfer was not sent from the declared payer");
  const sufficient = fromPayer.find((transfer) => transfer.value >= params.expectedBase);
  if (sufficient === undefined) {
    const best = fromPayer.reduce((max, transfer) => (transfer.value > max ? transfer.value : max), 0n);
    return fail("underpaid", `received ${best} base units, expected at least ${params.expectedBase}`);
  }
  return sufficient;
}

/** Create a verifier for one chain over an injectable {@link FullEvmRpc}. */
export function createEvmVerifier(options: EvmVerifierOptions): EvmVerifier {
  const { spec, rpc } = options;
  const minConfirmations = options.minConfirmations ?? spec.minConfirmations;
  const token = (options.tokenAddress ?? spec.token.address).toLowerCase() as Hex;
  let chainVerified = false;

  async function assertChainId(): Promise<void> {
    if (chainVerified) return;
    const actual = await rpc.getChainId();
    if (actual !== spec.chainId) {
      throw new ChainIdMismatchError(`${spec.name} RPC chain id mismatch: expected ${spec.chainId}, endpoint serves ${actual}`);
    }
    chainVerified = true;
  }

  async function checkReceipt(
    receipt: ArcTransactionReceipt,
    params: EvmVerifyParams,
  ): Promise<EvmVerification> {
    const picked = pickTransfer(decodeTokenTransfers(receipt, token), params, spec);
    if ("ok" in picked) return picked;
    const head = await rpc.getBlockNumber();
    const confirmations = head < receipt.blockNumber ? 0 : Number(head - receipt.blockNumber) + 1;
    const blockTime = new Date(Number(await rpc.getBlockTimestamp(receipt.blockNumber)) * 1000);
    if (params.notBefore && blockTime.getTime() < params.notBefore.getTime() - CLOCK_SKEW_MS) {
      return fail("too_old", "transaction was mined before the checkout session was created", false, confirmations);
    }
    if (confirmations < minConfirmations) {
      return fail(
        "insufficient_confirmations",
        `insufficient confirmations: ${confirmations} < ${minConfirmations}`,
        true,
        confirmations,
      );
    }
    return { ok: true, from: picked.from, amountBase: picked.value, confirmations, blockNumber: receipt.blockNumber, blockTime };
  }

  async function verifyOnChain(params: EvmVerifyParams): Promise<EvmVerification> {
    await assertChainId();
    const receipt = await rpc.getTransactionReceipt(params.txHash.toLowerCase() as Hex);
    if (receipt === null) return fail("not_found", "transaction not found or not yet mined", true);
    if (receipt.status !== "success") return fail("reverted", "transaction reverted");
    return checkReceipt(receipt, params);
  }

  async function verify(params: EvmVerifyParams): Promise<EvmVerification> {
    if (!TX_HASH_RE.test(params.txHash)) return fail("malformed", "malformed transaction hash");
    try {
      return await verifyOnChain(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ChainIdMismatchError) return fail("chain_mismatch", message);
      // Transport failures never confirm; the same tx may verify once the RPC answers.
      return fail("rpc_unavailable", `${spec.name} RPC unavailable: ${message}`, true);
    }
  }

  return { spec, minConfirmations, assertChainId, verify };
}
