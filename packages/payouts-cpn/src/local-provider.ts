/**
 * In-memory off-ramp provider for tests and local development. Deterministic
 * quotes at a flat 1.0 rate with a 0.5% fee, payouts recorded in memory and
 * marked "paid" immediately — never touches Circle or a bank rail. Exposes
 * aggregate inspection helpers like LocalSettlementProvider.
 */

import { type Money, type Result, addMoney, err, money, notFound, ok, toIso } from "@settlekit/common";
import {
  InMemoryPayoutStore,
  payoutId,
  quoteId,
  withPayoutIdempotency,
} from "./idempotency.js";
import { feeForAmount, netAfterFee } from "./quote-math.js";
import type {
  OffRampQuote,
  OffRampQuoteRequest,
  OffRampProvider,
  PayoutReceipt,
  PayoutRequest,
  PayoutStore,
} from "./types.js";
import { validatePayoutRequest, validateQuoteRequest } from "./validate.js";

/** How long a local quote is honoured. */
const QUOTE_TTL_MS = 5 * 60 * 1000;

export interface LocalProviderConfig {
  store?: PayoutStore;
  /** Injectable clock for deterministic tests. */
  clock?: () => Date;
}

export class LocalOffRampProvider implements OffRampProvider {
  readonly name = "local" as const;
  private readonly store: PayoutStore;
  private readonly clock: () => Date;
  private readonly receipts: PayoutReceipt[] = [];

  constructor(config: LocalProviderConfig = {}) {
    this.store = config.store ?? new InMemoryPayoutStore();
    this.clock = config.clock ?? (() => new Date());
  }

  async quote(req: OffRampQuoteRequest): Promise<Result<OffRampQuote>> {
    const validated = validateQuoteRequest(req);
    if (!validated.ok) return validated;

    const sourceAmount = money(req.amountUsdc);
    const feeUsdc = feeForAmount(sourceAmount);
    const net = netAfterFee(sourceAmount, feeUsdc);
    const now = this.clock();
    const quote: OffRampQuote = {
      id: quoteId(),
      reference: req.reference,
      sourceAmount,
      destinationCurrency: req.destinationCurrency,
      rate: "1",
      destinationAmount: net.amount,
      feeUsdc,
      expiresAt: toIso(new Date(now.getTime() + QUOTE_TTL_MS)),
      provider: "local",
    };
    return ok(quote);
  }

  async initiatePayout(req: PayoutRequest): Promise<Result<PayoutReceipt>> {
    const validated = validatePayoutRequest(req);
    if (!validated.ok) return validated;

    return withPayoutIdempotency(this.store, req, "local", async () => {
      const sourceAmount = money(req.amountUsdc);
      const feeUsdc = feeForAmount(sourceAmount);
      const net = netAfterFee(sourceAmount, feeUsdc);
      const now = toIso(this.clock());
      const receipt: PayoutReceipt = {
        id: payoutId(),
        reference: req.reference,
        amount: sourceAmount,
        destinationCurrency: req.destinationCurrency,
        destinationAmount: net.amount,
        status: "paid",
        provider: "local",
        cpnTransferId: `cpn_local_${payoutId().slice(3)}`,
        createdAt: now,
        settledAt: now,
      };
      this.receipts.push(receipt);
      return ok(receipt);
    });
  }

  async getPayoutStatus(reference: string): Promise<Result<PayoutReceipt>> {
    const existing = await this.store.get(reference);
    if (existing === undefined) {
      return err(notFound(`no payout for reference ${reference}`, { reference }));
    }
    return ok(existing);
  }

  /** All recorded receipts (newest last). For demos and assertions. */
  all(): readonly PayoutReceipt[] {
    return [...this.receipts];
  }

  /** Total USDC off-ramped across all recorded payouts. */
  totalVolume(): Money {
    return this.receipts.reduce<Money>((sum, r) => addMoney(sum, r.amount), money("0"));
  }
}
