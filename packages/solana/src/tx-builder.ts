/**
 * Build USDC payment transactions (server-side), per the Solana Pay layout:
 *
 *   1. CreateAssociatedTokenIdempotent — the recipient's ATA (no-op if it
 *      exists), funded by the payer, so a first-time merchant wallet works.
 *   2. Memo (optional) — immediately before the transfer.
 *   3. TransferChecked — payer ATA → recipient ATA, with every reference
 *      appended as a read-only, non-signer account so the payment can be
 *      found with `getSignaturesForAddress(reference)`.
 *
 * {@link buildUsdcPaymentTx} returns an UNSIGNED base64 v0 transaction whose
 * fee payer is the buyer: the wallet signs and sends it (Solana Pay
 * transaction request / wallet-standard `signAndSendTransaction`).
 */

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash as toBlockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getUtf8Encoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { SOLANA_USDC_DECIMALS } from "./clusters.js";
import type { LatestBlockhash } from "./rpc.js";

/** SPL Memo program (v2). */
export const MEMO_PROGRAM_ADDRESS = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export interface UsdcPaymentInstructionsParams {
  /** Signs the transfer and funds the recipient ATA if it must be created. */
  payer: TransactionSigner;
  /** Merchant wallet (ATA owner). */
  recipientOwner: string;
  mint: string;
  /** Amount in base units. */
  amount: bigint;
  decimals?: number;
  references?: readonly string[];
  memo?: string;
}

export interface BuildUsdcPaymentTxParams {
  /** Buyer wallet: fee payer and transfer authority. */
  buyer: string;
  recipientOwner: string;
  mint: string;
  amount: bigint;
  decimals?: number;
  reference?: string;
  references?: readonly string[];
  memo?: string;
  latestBlockhash: LatestBlockhash;
}

export interface BuiltPaymentTx {
  /** Unsigned wire transaction, base64. */
  transaction: string;
  lastValidBlockHeight: bigint;
  /** Resolved associated token accounts. */
  sourceTokenAccount: string;
  destinationTokenAccount: string;
}

function memoInstruction(memo: string, signer: TransactionSigner): Instruction {
  return {
    programAddress: MEMO_PROGRAM_ADDRESS,
    accounts: [{ address: signer.address, role: AccountRole.READONLY_SIGNER }],
    data: getUtf8Encoder().encode(memo),
  };
}

/** Derive the ATAs and build the ordered instruction list. */
export async function buildUsdcPaymentInstructions(
  params: UsdcPaymentInstructionsParams,
): Promise<{ instructions: Instruction[]; source: string; destination: string }> {
  if (params.amount <= 0n) throw new RangeError("payment amount must be positive");
  const mint = address(params.mint);
  const recipient = address(params.recipientOwner);
  const [source] = await findAssociatedTokenPda({
    owner: params.payer.address,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [destination] = await findAssociatedTokenPda({
    owner: recipient,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const createAta = getCreateAssociatedTokenIdempotentInstruction({
    payer: params.payer,
    ata: destination,
    owner: recipient,
    mint,
  });
  const transfer = getTransferCheckedInstruction({
    source,
    mint,
    destination,
    authority: params.payer,
    amount: params.amount,
    decimals: params.decimals ?? SOLANA_USDC_DECIMALS,
  });
  const transferWithRefs: Instruction = {
    ...transfer,
    accounts: [
      ...transfer.accounts,
      ...(params.references ?? []).map((ref) => ({
        address: address(ref),
        role: AccountRole.READONLY,
      })),
    ],
  };

  const instructions: Instruction[] = [
    createAta,
    ...(params.memo !== undefined ? [memoInstruction(params.memo, params.payer)] : []),
    transferWithRefs,
  ];
  return { instructions, source, destination };
}

/** Build the unsigned buyer-pays USDC transaction (base64 v0 wire format). */
export async function buildUsdcPaymentTx(params: BuildUsdcPaymentTxParams): Promise<BuiltPaymentTx> {
  const buyer = createNoopSigner(address(params.buyer));
  const references = [
    ...(params.reference !== undefined ? [params.reference] : []),
    ...(params.references ?? []),
  ];
  const { instructions, source, destination } = await buildUsdcPaymentInstructions({
    payer: buyer,
    recipientOwner: params.recipientOwner,
    mint: params.mint,
    amount: params.amount,
    ...(params.decimals !== undefined ? { decimals: params.decimals } : {}),
    references,
    ...(params.memo !== undefined ? { memo: params.memo } : {}),
  });

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(buyer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: toBlockhash(params.latestBlockhash.blockhash),
          lastValidBlockHeight: params.latestBlockhash.lastValidBlockHeight,
        },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );

  return {
    transaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    lastValidBlockHeight: params.latestBlockhash.lastValidBlockHeight,
    sourceTokenAccount: source,
    destinationTokenAccount: destination,
  };
}
