/**
 * The contract between the charge engine and each collection method.
 *
 * A provider pulls ONE period for ONE subscription. It must call
 * `recordStep` with every transaction hash/signature as soon as it is
 * broadcast (before waiting), and on a resumed charge (non-empty
 * `charge.steps`) reconcile those first instead of sending again.
 *
 * Errors classify the outcome:
 *  - {@link ChargeDeclinedError}      definite failure -> charge failed, dunning
 *  - {@link IndeterminateChargeError} broadcast but outcome unknown -> charge
 *                                     stays pending; resumed after the lease
 *  - {@link DeferChargeError}         not collectable yet (chain clock behind,
 *                                     RPC down) -> released, retried next tick,
 *                                     no dunning
 * Any other thrown error is treated as a definite failure.
 */
import type { BillingMethod, OnchainCharge, OnchainSubscription } from "./types.js";

export class ChargeDeclinedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChargeDeclinedError";
  }
}

export class IndeterminateChargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndeterminateChargeError";
  }
}

export class DeferChargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeferChargeError";
  }
}

export interface CollectContext {
  now: Date;
  /** The claimed charge, including steps recorded by a previous owner. */
  charge: OnchainCharge;
  /** Sum (base units) of this subscription's previously succeeded charges. */
  priorCollected: bigint;
  recordStep(step: string, txHash: string): Promise<void>;
}

export type CollectOutcome =
  | { status: "succeeded"; txHash?: string; note?: string }
  | { status: "awaiting_payment"; invoiceRef: string };

export type InvoiceStatus = "paid" | "open" | "expired";

export interface ChargeProvider {
  readonly method: BillingMethod;
  collect(subscription: OnchainSubscription, context: CollectContext): Promise<CollectOutcome>;
  /** Invoice providers: whether an outstanding renewal invoice was paid. */
  invoiceStatus?(subscription: OnchainSubscription, charge: OnchainCharge): Promise<InvoiceStatus>;
}

export function findStep(charge: OnchainCharge, step: string): string | undefined {
  return [...charge.steps].reverse().find((entry) => entry.step === step)?.txHash;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
