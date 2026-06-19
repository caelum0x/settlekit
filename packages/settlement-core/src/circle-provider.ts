/**
 * Settlement via Circle programmable wallets. Each settlement is a real USDC
 * transfer; the business `reference` is the Circle idempotency key, so a retry
 * after a timeout can never double-spend.
 */

import { SettleKitError, money, toIso } from "@settlekit/common";
import type { CircleTransactionResource, WalletsClient } from "@settlekit/circle-wallets";
import { InMemoryIdempotencyStore, settlementId, withIdempotency } from "./idempotency.js";
import type {
  IdempotencyStore,
  SettlementProvider,
  SettlementReceipt,
  SettlementRequest,
} from "./types.js";

/** Configuration for {@link CircleSettlementProvider}. */
export interface CircleProviderConfig {
  wallets: WalletsClient;
  /** Funded source wallet id. */
  walletId: string;
  /** Circle token id for USDC on the target chain. */
  tokenId: string;
  feeLevel?: "LOW" | "MEDIUM" | "HIGH";
  pollIntervalMs?: number;
  maxWaitMs?: number;
  idempotency?: IdempotencyStore;
  sleep?: (ms: number) => Promise<void>;
}

const TERMINAL_FAILURE = new Set(["FAILED", "CANCELLED", "DENIED"]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CircleSettlementProvider implements SettlementProvider {
  readonly name = "circle" as const;
  private readonly config: CircleProviderConfig;
  private readonly idempotency: IdempotencyStore;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: CircleProviderConfig) {
    this.config = config;
    this.idempotency = config.idempotency ?? new InMemoryIdempotencyStore();
    this.sleep = config.sleep ?? defaultSleep;
  }

  private async awaitTxHash(transactionId: string): Promise<string> {
    const deadline = Date.now() + (this.config.maxWaitMs ?? 60_000);
    const interval = this.config.pollIntervalMs ?? 1500;
    for (;;) {
      const tx: CircleTransactionResource = await this.config.wallets.getTransaction(transactionId);
      if (typeof tx.txHash === "string" && tx.txHash.length > 0) {
        return tx.txHash;
      }
      if (TERMINAL_FAILURE.has(tx.state)) {
        throw new SettleKitError({
          code: "payment_failed",
          message: `circle transfer ${tx.state}: ${tx.errorReason ?? "unknown"}`,
        });
      }
      if (Date.now() >= deadline) {
        throw new SettleKitError({
          code: "payment_failed",
          message: "timed out waiting for transaction hash",
          retryable: true,
        });
      }
      await this.sleep(interval);
    }
  }

  async settle(request: SettlementRequest): Promise<SettlementReceipt> {
    return withIdempotency(this.idempotency, request, "circle", async () => {
      const createdAt = toIso(new Date());
      const created = await this.config.wallets.createTransfer({
        walletId: this.config.walletId,
        destinationAddress: request.to,
        tokenId: this.config.tokenId,
        amount: request.amountUsdc,
        feeLevel: this.config.feeLevel ?? "MEDIUM",
        idempotencyKey: request.reference,
      });
      const txHash = await this.awaitTxHash(created.id);
      return {
        id: settlementId(),
        reference: request.reference,
        to: request.to,
        amount: money(request.amountUsdc),
        network: request.network,
        status: "settled",
        provider: "circle",
        txHash,
        createdAt,
        settledAt: toIso(new Date()),
      };
    });
  }
}
