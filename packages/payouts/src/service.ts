import type { Money, Payment, Result, SettleKitError } from "@settlekit/common";
import { generateId, notFound, ok } from "@settlekit/common";
import { computeAvailableBalance, createPayout, markFailed, markPaid } from "./payout.js";
import type { PayoutStore } from "./store.js";
import type { Payout, PayoutNetwork } from "./types.js";

/** Arguments accepted by PayoutService.create (store-aware wrapper). */
export interface ServiceCreatePayoutInput {
  organizationId: string;
  walletAddress: string;
  amount: string;
  network: PayoutNetwork;
  /** Confirmed payments backing the merchant balance. */
  payments: readonly Payment[];
}

/**
 * Orchestrates merchant payouts against a PayoutStore. Available balance is
 * computed from supplied confirmed payments minus prior payouts already on file.
 */
export class PayoutService {
  constructor(
    private readonly store: PayoutStore,
    private readonly generate: () => string = () => generateId("payoutWallet"),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: ServiceCreatePayoutInput): Promise<Result<Payout, SettleKitError>> {
    const priorPayouts = await this.store.listByOrganization(input.organizationId);
    const created = createPayout({ ...input, priorPayouts }, this.generate, this.now());
    if (!created.ok) return created;
    const saved = await this.store.save(created.value);
    return ok(saved);
  }

  async markPaid(payoutId: string, txHash: string): Promise<Result<Payout, SettleKitError>> {
    const existing = await this.store.findById(payoutId);
    if (!existing) return { ok: false, error: notFound(`payout ${payoutId} not found`) };
    const transitioned = markPaid(existing, txHash, this.now());
    if (!transitioned.ok) return transitioned;
    const saved = await this.store.save(transitioned.value);
    return ok(saved);
  }

  async markFailed(payoutId: string, reason: string): Promise<Result<Payout, SettleKitError>> {
    const existing = await this.store.findById(payoutId);
    if (!existing) return { ok: false, error: notFound(`payout ${payoutId} not found`) };
    const transitioned = markFailed(existing, reason, this.now());
    if (!transitioned.ok) return transitioned;
    const saved = await this.store.save(transitioned.value);
    return ok(saved);
  }

  async get(payoutId: string): Promise<Payout | undefined> {
    return this.store.findById(payoutId);
  }

  async listByOrganization(organizationId: string): Promise<Payout[]> {
    return this.store.listByOrganization(organizationId);
  }

  async availableBalance(organizationId: string, payments: readonly Payment[]): Promise<Money> {
    const priorPayouts = await this.store.listByOrganization(organizationId);
    return computeAvailableBalance(payments, priorPayouts);
  }
}
