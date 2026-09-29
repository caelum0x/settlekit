/**
 * Solana USDC settlement from a hot wallet.
 *
 * Each settlement is one real `TransferChecked` (recipient ATA created
 * idempotently) with the business `reference` written as an SPL memo, so every
 * payout is auditable on-chain. Idempotency goes through the shared
 * {@link withIdempotency} reserve/release protocol: a concurrent or retried
 * settle() with the same reference can never send twice.
 */

import {
  appendTransactionMessageInstructions,
  blockhash as toBlockhash,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "@solana/kit";
import { SettleKitError, money, toBaseUnits, toIso, validationError } from "@settlekit/common";
import {
  InMemoryIdempotencyStore,
  settlementId,
  withIdempotency,
  type IdempotencyStore,
  type SettlementProvider,
  type SettlementReceipt,
  type SettlementRequest,
} from "@settlekit/settlement-core";
import { SOLANA_USDC_DECIMALS, type SolanaFinality } from "./clusters.js";
import type { SolanaRpc, SignatureStatus } from "./rpc.js";
import { buildUsdcPaymentInstructions } from "./tx-builder.js";
import { isSolanaAddress } from "./validate.js";

export interface SolanaSettlementConfig {
  rpc: SolanaRpc;
  /** Hot wallet: fee payer and USDC source. */
  signer: TransactionSigner;
  /** USDC mint for the cluster. */
  mint: string;
  decimals?: number;
  /** Status required before a settlement counts as settled. Default "confirmed". */
  commitment?: SolanaFinality;
  idempotency?: IdempotencyStore;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_MAX_WAIT_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function meetsCommitment(status: SignatureStatus, commitment: SolanaFinality): boolean {
  if (status.confirmationStatus === "finalized") return true;
  return commitment === "confirmed" && status.confirmationStatus === "confirmed";
}

/**
 * Parse a hot-wallet secret: a base58 64-byte secret key, or a JSON byte
 * array (the `solana-keygen` file format).
 */
export async function createSolanaSignerFromSecret(secret: string): Promise<TransactionSigner> {
  const trimmed = secret.trim();
  const bytes = trimmed.startsWith("[")
    ? Uint8Array.from(JSON.parse(trimmed) as number[])
    : new Uint8Array(getBase58Encoder().encode(trimmed));
  if (bytes.length !== 64) {
    throw new RangeError(`Solana secret key must be 64 bytes, got ${bytes.length}`);
  }
  return createKeyPairSignerFromBytes(bytes);
}

export class SolanaSettlementProvider implements SettlementProvider {
  readonly name = "solana" as const;
  private readonly config: SolanaSettlementConfig;
  private readonly idempotency: IdempotencyStore;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: SolanaSettlementConfig) {
    this.config = config;
    this.idempotency = config.idempotency ?? new InMemoryIdempotencyStore();
    this.sleep = config.sleep ?? defaultSleep;
  }

  private async submit(request: SettlementRequest): Promise<string> {
    const { instructions } = await buildUsdcPaymentInstructions({
      payer: this.config.signer,
      recipientOwner: request.to,
      mint: this.config.mint,
      amount: toBaseUnits(money(request.amountUsdc).amount),
      decimals: this.config.decimals ?? SOLANA_USDC_DECIMALS,
      memo: request.reference,
    });
    const latest = await this.config.rpc.getLatestBlockhash("confirmed");
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.config.signer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: toBlockhash(latest.blockhash), lastValidBlockHeight: latest.lastValidBlockHeight },
          m,
        ),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(signed);
    await this.config.rpc.sendTransaction(getBase64EncodedWireTransaction(signed));
    return signature;
  }

  private async awaitConfirmation(signature: string): Promise<void> {
    const commitment = this.config.commitment ?? "confirmed";
    const deadline = Date.now() + (this.config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
    const interval = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    for (;;) {
      const [status] = await this.config.rpc.getSignatureStatuses([signature]);
      if (status && status.err !== null && status.err !== undefined) {
        throw new SettleKitError({
          code: "payment_failed",
          message: `solana transfer ${signature} failed: ${JSON.stringify(status.err)}`,
        });
      }
      if (status && meetsCommitment(status, commitment)) return;
      if (Date.now() >= deadline) {
        throw new SettleKitError({
          code: "payment_failed",
          message: `timed out waiting for ${commitment} status of ${signature}`,
          retryable: true,
        });
      }
      await this.sleep(interval);
    }
  }

  async settle(request: SettlementRequest): Promise<SettlementReceipt> {
    if (request.network !== "solana") {
      throw validationError(`SolanaSettlementProvider cannot settle on ${request.network}`);
    }
    if (!isSolanaAddress(request.to)) {
      throw validationError(`invalid Solana recipient address: ${request.to}`);
    }
    return withIdempotency(this.idempotency, request, "solana", async () => {
      const createdAt = toIso(new Date());
      const txHash = await this.submit(request);
      await this.awaitConfirmation(txHash);
      return {
        id: settlementId(),
        reference: request.reference,
        to: request.to,
        amount: money(request.amountUsdc),
        network: request.network,
        status: "settled",
        provider: "solana",
        txHash,
        createdAt,
        settledAt: toIso(new Date()),
      };
    });
  }
}
