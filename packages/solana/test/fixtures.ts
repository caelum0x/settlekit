/**
 * Hand-built `getTransaction(sig, { encoding: "jsonParsed",
 * maxSupportedTransactionVersion: 0 })` responses, shaped exactly like the
 * JSON a Solana node returns for a Solana Pay USDC payment:
 *
 *   ix0 ATA CreateIdempotent(merchant ATA)   ix1 TransferChecked(+reference)
 *
 * Account keys follow v0 message ordering (writable signers, writable
 * non-signers, read-only non-signers) and token balances reference them by
 * `accountIndex`.
 */

import { getAddressDecoder, getBase58Decoder } from "@solana/kit";
import type {
  LatestBlockhash,
  ParsedAccountKey,
  ParsedTransaction,
  SignatureInfo,
  SignatureStatus,
  SolanaRpc,
  TokenBalance,
} from "../src/rpc.js";

export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const FAKE_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export const MERCHANT = "mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN";
export const MERCHANT_ATA = "5ZGPSxMzV9xV5s3Wep73r8k5MsPAtLYs11dGDdknznM5";
export const BUYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const BUYER_ATA = "FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B";
export const OTHER_WALLET = "7oH4nq2SxuoczGGwJkxZpYJd88iHH4sUx9WTPt57pnSC";
export const OTHER_WALLET_ATA = "7sCMw8VTZD6r8MXSk4HV7R5PNHvUx8ZJWZB7TG7ia7ku";
export const REFERENCE = "7w7f5RxU9WQ5GSmxBMcQQHr9cT8gdCF84xqmWeAKKT5c";
export const RECENT_BLOCKHASH = "812xDjRUjohJQY2TcewKhAcurcLtJFvwdNWRa2Cv4nQK";
/** Merchant-owned token account of the look-alike mint. */
export const MERCHANT_FAKE_TOKEN_ACCOUNT = getAddressDecoder().decode(new Uint8Array(32).fill(55));

/** A deterministic, well-formed 64-byte base58 signature. */
export function sig(seed: number): string {
  const bytes = new Uint8Array(64).fill(seed);
  bytes[0] = 200;
  return getBase58Decoder().decode(bytes);
}

export const PAYMENT_SIG = sig(1);

function key(pubkey: string, signer: boolean, writable: boolean): ParsedAccountKey {
  return { pubkey, signer, writable, source: "transaction" };
}

function balance(accountIndex: number, owner: string, amount: bigint, mint = USDC): TokenBalance {
  const ui = Number(amount) / 1_000_000;
  return {
    accountIndex,
    mint,
    owner,
    programId: TOKEN_PROGRAM,
    uiTokenAmount: {
      amount: amount.toString(),
      decimals: 6,
      uiAmount: ui,
      uiAmountString: String(ui),
    },
  };
}

export interface TransferTxOptions {
  amount?: bigint;
  /** Mint actually moved (a look-alike token for the wrong-mint case). */
  mint?: string;
  /** Wallet that actually received the tokens. */
  recipient?: string;
  recipientAta?: string;
  /** Recipient pre balance; `null` means the ATA is created in this tx. */
  recipientPre?: bigint | null;
  buyerPre?: bigint;
  includeReference?: boolean;
  err?: unknown;
  signature?: string;
}

/** A single Solana Pay USDC payment: buyer → recipient ATA (+ reference). */
export function transferTx(options: TransferTxOptions = {}): ParsedTransaction {
  const amount = options.amount ?? 1_000_000n;
  const mint = options.mint ?? USDC;
  const recipient = options.recipient ?? MERCHANT;
  const recipientAta = options.recipientAta ?? MERCHANT_ATA;
  const recipientPre = options.recipientPre === undefined ? 5_000_000n : options.recipientPre;
  const buyerPre = options.buyerPre ?? 25_000_000n;
  const includeReference = options.includeReference ?? true;
  const signature = options.signature ?? PAYMENT_SIG;

  const accountKeys: ParsedAccountKey[] = [
    key(BUYER, true, true),
    key(BUYER_ATA, false, true),
    key(recipientAta, false, true),
    key(recipient, false, false),
    key(mint, false, false),
    ...(includeReference ? [key(REFERENCE, false, false)] : []),
    key(SYSTEM_PROGRAM, false, false),
    key(TOKEN_PROGRAM, false, false),
    key(ATA_PROGRAM, false, false),
  ];

  const preTokenBalances = [
    balance(1, BUYER, buyerPre, mint),
    ...(recipientPre === null ? [] : [balance(2, recipient, recipientPre, mint)]),
  ];
  const postTokenBalances = [
    balance(1, BUYER, buyerPre - amount, mint),
    balance(2, recipient, (recipientPre ?? 0n) + amount, mint),
  ];

  return {
    slot: 291_550_123,
    blockTime: 1_727_600_000,
    version: 0,
    meta: {
      err: options.err ?? null,
      fee: 5_000,
      preTokenBalances,
      postTokenBalances,
      logMessages: [
        `Program ${ATA_PROGRAM} invoke [1]`,
        `Program ${ATA_PROGRAM} success`,
        `Program ${TOKEN_PROGRAM} invoke [1]`,
        "Program log: Instruction: TransferChecked",
        `Program ${TOKEN_PROGRAM} success`,
      ],
    },
    transaction: {
      signatures: [signature],
      message: {
        accountKeys,
        recentBlockhash: RECENT_BLOCKHASH,
        instructions: [
          {
            parsed: {
              info: { account: recipientAta, mint, source: BUYER, systemProgram: SYSTEM_PROGRAM, tokenProgram: TOKEN_PROGRAM, wallet: recipient },
              type: "createIdempotent",
            },
            program: "spl-associated-token-account",
            programId: ATA_PROGRAM,
            stackHeight: null,
          },
          {
            parsed: {
              info: {
                authority: BUYER,
                destination: recipientAta,
                mint,
                source: BUYER_ATA,
                tokenAmount: { amount: amount.toString(), decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: String(Number(amount) / 1e6) },
              },
              type: "transferChecked",
            },
            program: "spl-token",
            programId: TOKEN_PROGRAM,
            stackHeight: null,
          },
        ],
      },
    },
  };
}

/**
 * One transaction with several transfers: the buyer pays the merchant in two
 * TransferChecked instructions (0.6 + 0.4 USDC) and a 0.05 platform fee to
 * another wallet, alongside an unrelated look-alike-token transfer to the
 * merchant that must be ignored.
 */
export function multiTransferTx(): ParsedTransaction {
  const accountKeys: ParsedAccountKey[] = [
    key(BUYER, true, true),
    key(BUYER_ATA, false, true),
    key(MERCHANT_ATA, false, true),
    key(OTHER_WALLET_ATA, false, true),
    key(MERCHANT_FAKE_TOKEN_ACCOUNT, false, true),
    key(MERCHANT, false, false),
    key(OTHER_WALLET, false, false),
    key(USDC, false, false),
    key(FAKE_USDC, false, false),
    key(REFERENCE, false, false),
    key(TOKEN_PROGRAM, false, false),
  ];
  return {
    slot: 291_550_999,
    blockTime: 1_727_600_400,
    version: 0,
    meta: {
      err: null,
      fee: 5_000,
      preTokenBalances: [
        balance(1, BUYER, 10_000_000n),
        balance(2, MERCHANT, 0n),
        balance(3, OTHER_WALLET, 0n),
        balance(4, MERCHANT, 0n, FAKE_USDC),
      ],
      postTokenBalances: [
        balance(1, BUYER, 8_950_000n),
        balance(2, MERCHANT, 1_000_000n),
        balance(3, OTHER_WALLET, 50_000n),
        balance(4, MERCHANT, 900_000_000n, FAKE_USDC),
      ],
      logMessages: [],
    },
    transaction: {
      signatures: [sig(2)],
      message: { accountKeys, recentBlockhash: RECENT_BLOCKHASH, instructions: [] },
    },
  };
}

export interface FakeRpcState {
  transactions?: Record<string, ParsedTransaction>;
  signaturesByAddress?: Record<string, SignatureInfo[]>;
  statuses?: Record<string, SignatureStatus | null>;
  blockhash?: LatestBlockhash;
}

/** In-memory {@link SolanaRpc}: answers from canned state, records calls. */
export function fakeRpc(state: FakeRpcState = {}): SolanaRpc & {
  sent: string[];
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const sent: string[] = [];
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    sent,
    calls,
    async getTransaction(signature, commitment) {
      calls.push({ method: "getTransaction", args: [signature, commitment] });
      return state.transactions?.[signature] ?? null;
    },
    async getSignaturesForAddress(address, options = {}) {
      calls.push({ method: "getSignaturesForAddress", args: [address, options] });
      const all = state.signaturesByAddress?.[address] ?? [];
      const start = options.before === undefined ? 0 : all.findIndex((s) => s.signature === options.before) + 1;
      return all.slice(start, start + (options.limit ?? 1_000));
    },
    async getLatestBlockhash() {
      calls.push({ method: "getLatestBlockhash", args: [] });
      return state.blockhash ?? { blockhash: RECENT_BLOCKHASH, lastValidBlockHeight: 280_000_150n };
    },
    async sendTransaction(base64Transaction) {
      calls.push({ method: "sendTransaction", args: [base64Transaction] });
      sent.push(base64Transaction);
      return "sent";
    },
    async getSignatureStatuses(signatures) {
      calls.push({ method: "getSignatureStatuses", args: [signatures] });
      return signatures.map((s) =>
        state.statuses && s in state.statuses
          ? (state.statuses[s] ?? null)
          : { slot: 291_551_000, confirmations: null, err: null, confirmationStatus: "finalized" as const },
      );
    },
  };
}
