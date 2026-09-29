/**
 * Narrow Solana RPC seam plus a real implementation over `@solana/kit`.
 *
 * Mirrors `@settlekit/arc`'s `ArcRpc`: domain logic (transfer verification,
 * reference lookup, settlement) depends only on {@link SolanaRpc}, so tests
 * inject canned `jsonParsed` responses while production talks to a real node.
 * The shapes below are the JSON-RPC wire shapes (numbers + strings), so a
 * fixture captured from a node can be used verbatim.
 */

import { address, createSolanaRpc, signature as toSignature } from "@solana/kit";
import type { Base64EncodedWireTransaction } from "@solana/kit";
import type { SolanaFinality } from "./clusters.js";

/** One entry of `transaction.message.accountKeys` under `jsonParsed`. */
export interface ParsedAccountKey {
  pubkey: string;
  signer: boolean;
  writable: boolean;
  /** `"transaction"` for static keys, `"lookupTable"` for ALT-loaded keys. */
  source?: string;
}

/** An SPL token balance snapshot (`meta.preTokenBalances` / `postTokenBalances`). */
export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: {
    /** Raw base-unit amount as a decimal string. */
    amount: string;
    decimals: number;
    uiAmount?: number | null;
    uiAmountString?: string;
  };
}

/** The subset of `getTransaction(sig, { encoding: "jsonParsed" })` we read. */
export interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  version?: number | "legacy";
  meta: {
    err: unknown;
    fee?: number;
    preTokenBalances?: readonly TokenBalance[] | null;
    postTokenBalances?: readonly TokenBalance[] | null;
    logMessages?: readonly string[] | null;
  } | null;
  transaction: {
    signatures: readonly string[];
    message: {
      accountKeys: readonly ParsedAccountKey[];
      recentBlockhash?: string;
      instructions?: readonly unknown[];
    };
  };
}

/** One entry of `getSignaturesForAddress`. */
export interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  memo: string | null;
  blockTime: number | null;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
}

/** One entry of `getSignatureStatuses` (null when the node has no record). */
export interface SignatureStatus {
  slot: number;
  confirmations: number | null;
  err: unknown;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
}

export interface LatestBlockhash {
  blockhash: string;
  lastValidBlockHeight: bigint;
}

export interface GetSignaturesOptions {
  before?: string;
  until?: string;
  limit?: number;
  commitment?: SolanaFinality;
}

/** The on-chain reads/writes the Solana package depends on. */
export interface SolanaRpc {
  /** `getTransaction` with `jsonParsed` + `maxSupportedTransactionVersion: 0`; null if unknown. */
  getTransaction(signature: string, commitment: SolanaFinality): Promise<ParsedTransaction | null>;
  /** Signatures touching `address`, newest first. */
  getSignaturesForAddress(address: string, options?: GetSignaturesOptions): Promise<SignatureInfo[]>;
  getLatestBlockhash(commitment?: SolanaFinality): Promise<LatestBlockhash>;
  /** Submit a signed base64 wire transaction; resolves with its signature. */
  sendTransaction(base64Transaction: string, options?: { skipPreflight?: boolean }): Promise<string>;
  getSignatureStatuses(signatures: readonly string[]): Promise<Array<SignatureStatus | null>>;
}

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function toNullableNumber(value: bigint | number | null | undefined): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

/**
 * Normalize kit's response (bigints, branded strings) into the plain wire
 * shapes of {@link ParsedTransaction}.
 */
function normalizeTransaction(raw: unknown): ParsedTransaction | null {
  if (raw === null || raw === undefined) return null;
  const tx = raw as {
    slot: bigint;
    blockTime: bigint | null;
    version?: number | "legacy";
    meta: {
      err: unknown;
      fee?: bigint;
      preTokenBalances?: readonly TokenBalance[];
      postTokenBalances?: readonly TokenBalance[];
      logMessages?: readonly string[] | null;
    } | null;
    transaction: ParsedTransaction["transaction"];
  };
  return {
    slot: toNumber(tx.slot),
    blockTime: toNullableNumber(tx.blockTime),
    ...(tx.version !== undefined ? { version: tx.version } : {}),
    meta:
      tx.meta === null
        ? null
        : {
            err: tx.meta.err,
            ...(tx.meta.fee !== undefined ? { fee: toNumber(tx.meta.fee) } : {}),
            preTokenBalances: tx.meta.preTokenBalances ?? null,
            postTokenBalances: tx.meta.postTokenBalances ?? null,
            logMessages: tx.meta.logMessages ?? null,
          },
    transaction: tx.transaction,
  };
}

/** Real {@link SolanaRpc} over `@solana/kit`'s JSON-RPC client. */
export function createKitSolanaRpc(rpcUrl: string): SolanaRpc {
  const rpc = createSolanaRpc(rpcUrl);

  return {
    async getTransaction(sig, commitment) {
      const raw = await rpc
        .getTransaction(toSignature(sig), {
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
          commitment,
        })
        .send();
      return normalizeTransaction(raw);
    },

    async getSignaturesForAddress(addr, options = {}) {
      const rows = await rpc
        .getSignaturesForAddress(address(addr), {
          ...(options.before !== undefined ? { before: toSignature(options.before) } : {}),
          ...(options.until !== undefined ? { until: toSignature(options.until) } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
          ...(options.commitment !== undefined ? { commitment: options.commitment } : {}),
        })
        .send();
      return rows.map((row) => ({
        signature: row.signature,
        slot: toNumber(row.slot),
        err: row.err,
        memo: row.memo,
        blockTime: toNullableNumber(row.blockTime),
        confirmationStatus: row.confirmationStatus,
      }));
    },

    async getLatestBlockhash(commitment = "confirmed") {
      const { value } = await rpc.getLatestBlockhash({ commitment }).send();
      return { blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight };
    },

    async sendTransaction(base64Transaction, options = {}) {
      const sig = await rpc
        .sendTransaction(base64Transaction as Base64EncodedWireTransaction, {
          encoding: "base64",
          ...(options.skipPreflight !== undefined ? { skipPreflight: options.skipPreflight } : {}),
          preflightCommitment: "confirmed",
        })
        .send();
      return sig;
    },

    async getSignatureStatuses(signatures) {
      const { value } = await rpc
        .getSignatureStatuses(signatures.map((s) => toSignature(s)), {
          searchTransactionHistory: true,
        })
        .send();
      return value.map((status) =>
        status === null
          ? null
          : {
              slot: toNumber(status.slot),
              confirmations: toNullableNumber(status.confirmations),
              err: status.err,
              confirmationStatus: status.confirmationStatus,
            },
      );
    },
  };
}
