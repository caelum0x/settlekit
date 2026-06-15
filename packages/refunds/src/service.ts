import type { Money, Payment, Result, SettleKitError } from "@settlekit/common";
import { generateId, notFound, ok } from "@settlekit/common";
import {
  createRefund,
  markFailed,
  markSucceeded,
  refundableRemaining,
  type CreateRefundInput,
} from "./refund.js";
import type { RefundStore } from "./store.js";
import type { Refund, RefundReason } from "./types.js";

/** Arguments accepted by RefundService.create (store-aware wrapper). */
export interface ServiceCreateRefundInput {
  payment: Payment;
  customerId: string;
  amount: string;
  reason: RefundReason;
}

/**
 * Orchestrates refund creation and transitions against a RefundStore.
 * All fallible operations return a Result; persistence is delegated to the store.
 */
export class RefundService {
  constructor(
    private readonly store: RefundStore,
    private readonly generate: () => string = () => generateId("payment"),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(input: ServiceCreateRefundInput): Promise<Result<Refund, SettleKitError>> {
    const existingRefunds = await this.store.listByPayment(input.payment.id);
    const createInput: CreateRefundInput = { ...input, existingRefunds };
    const created = createRefund(createInput, this.generate, this.now());
    if (!created.ok) return created;
    const saved = await this.store.save(created.value);
    return ok(saved);
  }

  async markSucceeded(refundId: string): Promise<Result<Refund, SettleKitError>> {
    const existing = await this.store.findById(refundId);
    if (!existing) return { ok: false, error: notFound(`refund ${refundId} not found`) };
    const transitioned = markSucceeded(existing, this.now());
    if (!transitioned.ok) return transitioned;
    const saved = await this.store.save(transitioned.value);
    return ok(saved);
  }

  async markFailed(refundId: string, reason: string): Promise<Result<Refund, SettleKitError>> {
    const existing = await this.store.findById(refundId);
    if (!existing) return { ok: false, error: notFound(`refund ${refundId} not found`) };
    const transitioned = markFailed(existing, reason, this.now());
    if (!transitioned.ok) return transitioned;
    const saved = await this.store.save(transitioned.value);
    return ok(saved);
  }

  async listByPayment(paymentId: string): Promise<Refund[]> {
    return this.store.listByPayment(paymentId);
  }

  async listByCustomer(customerId: string): Promise<Refund[]> {
    return this.store.listByCustomer(customerId);
  }

  async remainingRefundable(payment: Payment): Promise<Money> {
    const existing = await this.store.listByPayment(payment.id);
    return refundableRemaining(payment, existing);
  }
}
