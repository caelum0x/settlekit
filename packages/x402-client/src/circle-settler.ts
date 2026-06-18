/**
 * A {@link Settler} backed by Circle programmable wallets. It executes a real
 * USDC transfer to the challenge's `payTo` address and polls until the
 * transaction has an on-chain hash, then returns that as the x402 proof.
 *
 * Use this when `CIRCLE_WALLETS_API_KEY` and a funded wallet are configured to
 * push genuine testnet-USDC volume through the agent economy.
 */

import { SettleKitError } from "@settlekit/common";
import type {
  CircleTransactionResource,
  WalletsClient,
} from "@settlekit/circle-wallets";
import type { PaymentProof } from "@settlekit/x402";
import type { Settler, SettleRequest } from "./types.js";

/** Configuration for {@link createCircleWalletSettler}. */
export interface CircleSettlerConfig {
  /** The Circle wallets client (settlekit/circle-wallets). */
  wallets: WalletsClient;
  /** The funded source wallet id. */
  walletId: string;
  /** The Circle token id for USDC on the target chain. */
  tokenId: string;
  /** The on-chain address of the source wallet (echoed as proof.from). */
  fromAddress: string;
  /** Transaction speed. Defaults to MEDIUM. */
  feeLevel?: "LOW" | "MEDIUM" | "HIGH";
  /** Poll interval while waiting for a txHash. Defaults to 1500ms. */
  pollIntervalMs?: number;
  /** Max time to wait for a txHash before failing. Defaults to 60000ms. */
  maxWaitMs?: number;
  /** Injectable clock/sleep for testing. */
  sleep?: (ms: number) => Promise<void>;
}

const TERMINAL_FAILURE = new Set(["FAILED", "CANCELLED", "DENIED"]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a Circle-backed settler. The returned settler transfers `amount` USDC
 * from the configured wallet to the challenge's `payTo`, waits for the txHash,
 * and returns a {@link PaymentProof}.
 */
export function createCircleWalletSettler(config: CircleSettlerConfig): Settler {
  const pollIntervalMs = config.pollIntervalMs ?? 1500;
  const maxWaitMs = config.maxWaitMs ?? 60_000;
  const sleep = config.sleep ?? defaultSleep;

  async function awaitTxHash(transactionId: string): Promise<string> {
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const tx: CircleTransactionResource = await config.wallets.getTransaction(transactionId);
      if (typeof tx.txHash === "string" && tx.txHash.length > 0) {
        return tx.txHash;
      }
      if (TERMINAL_FAILURE.has(tx.state)) {
        throw paymentFailed(`circle transfer ${tx.state}: ${tx.errorReason ?? "unknown"}`);
      }
      if (Date.now() >= deadline) {
        throw paymentFailed("timed out waiting for transaction hash");
      }
      await sleep(pollIntervalMs);
    }
  }

  return {
    async settle(request: SettleRequest): Promise<PaymentProof> {
      const { requirements } = request;
      // Deterministic idempotency key: the same x402 challenge (nonce) settles to
      // the same transfer, so a timeout-then-retry can never double-spend.
      const created = await config.wallets.createTransfer({
        walletId: config.walletId,
        destinationAddress: requirements.payTo,
        tokenId: config.tokenId,
        amount: requirements.amount,
        feeLevel: config.feeLevel ?? "MEDIUM",
        idempotencyKey: `x402:${requirements.productId}:${requirements.nonce}`,
      });
      const txHash = await awaitTxHash(created.id);
      return {
        txHash,
        from: config.fromAddress,
        amount: requirements.amount,
        network: requirements.network,
        nonce: requirements.nonce,
      };
    },
  };
}

function paymentFailed(message: string): SettleKitError {
  return new SettleKitError({
    code: "payment_failed",
    message,
    retryable: true,
    details: { source: "circle-settler" },
  });
}
