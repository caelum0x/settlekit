/**
 * {@link ArcSettlementProvider} — bridges an {@link ArcPaymentClient} to the
 * settlement spine, implementing `@settlekit/settlement-core`'s
 * `SettlementProvider`. This is the "go live on Arc" seam: once a deployment
 * injects this provider, the worker's settlement jobs move *real* USDC on Arc
 * via Circle App Kit instead of the no-op `local` provider.
 *
 * Settlements are idempotent (via `withIdempotency` keyed on `request.reference`)
 * so a retried job never double-spends. Retryable App Kit failures are rethrown
 * (the pending claim is released so a later run can retry); terminal failures
 * are recorded as a `failed` receipt and never retried.
 */

import { type Money, type PaymentNetwork, money, toIso } from "@settlekit/common";
import {
  type IdempotencyStore,
  InMemoryIdempotencyStore,
  type SettlementProvider,
  type SettlementReceipt,
  type SettlementRequest,
  settlementId,
  withIdempotency,
} from "@settlekit/settlement-core";
import type { ArcPaymentClient } from "./client.js";
import type { SupportedChain } from "./types.js";

/** Map each payment network to its testnet App Kit chain. */
const TESTNET_CHAINS: Readonly<Record<PaymentNetwork, SupportedChain>> = {
  arc: "Arc_Testnet",
  base: "Base_Sepolia",
  ethereum: "Ethereum_Sepolia",
};

/** Map each payment network to its mainnet App Kit chain. */
const MAINNET_CHAINS: Readonly<Record<PaymentNetwork, SupportedChain>> = {
  arc: "Arc_Mainnet",
  base: "Base",
  ethereum: "Ethereum",
};

/** Configuration for {@link ArcSettlementProvider}. */
export interface ArcSettlementProviderConfig<A> {
  /** The configured App Kit facade. */
  client: ArcPaymentClient<A>;
  /** The signing adapter used for every settlement transfer. */
  adapter: A;
  /**
   * Network → chain mapping. "testnet" (default) or "mainnet" select a built-in
   * map; pass a record for custom routing.
   */
  chains?: "testnet" | "mainnet" | Readonly<Record<PaymentNetwork, SupportedChain>>;
  /** Idempotency store; defaults to an in-memory store. */
  idempotency?: IdempotencyStore;
}

export class ArcSettlementProvider<A> implements SettlementProvider {
  readonly name = "circle" as const;
  private readonly client: ArcPaymentClient<A>;
  private readonly adapter: A;
  private readonly chains: Readonly<Record<PaymentNetwork, SupportedChain>>;
  private readonly idempotency: IdempotencyStore;

  constructor(config: ArcSettlementProviderConfig<A>) {
    this.client = config.client;
    this.adapter = config.adapter;
    this.idempotency = config.idempotency ?? new InMemoryIdempotencyStore();
    if (config.chains === undefined || config.chains === "testnet") {
      this.chains = TESTNET_CHAINS;
    } else if (config.chains === "mainnet") {
      this.chains = MAINNET_CHAINS;
    } else {
      this.chains = config.chains;
    }
  }

  async settle(request: SettlementRequest): Promise<SettlementReceipt> {
    return withIdempotency(this.idempotency, request, "circle", async () => {
      const now = toIso(new Date());
      const amount: Money = money(request.amountUsdc);
      const result = await this.client.send({
        adapter: this.adapter,
        chain: this.chains[request.network],
        to: request.to,
        amount: request.amountUsdc,
      });

      if (!result.ok) {
        // Retryable failures bubble up so the pending claim is released and a
        // later run can retry; terminal failures are recorded as `failed`.
        if (result.error.retryable) {
          throw result.error;
        }
        return {
          id: settlementId(),
          reference: request.reference,
          to: request.to,
          amount,
          network: request.network,
          status: "failed",
          provider: "circle",
          failureReason: result.error.message,
          createdAt: now,
        };
      }

      const settled = result.value.status === "success";
      return {
        id: settlementId(),
        reference: request.reference,
        to: request.to,
        amount,
        network: request.network,
        status: settled ? "settled" : "submitted",
        provider: "circle",
        ...(result.value.txHash !== undefined ? { txHash: result.value.txHash } : {}),
        createdAt: now,
        ...(settled ? { settledAt: now } : {}),
      };
    });
  }
}
