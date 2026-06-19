/**
 * Settling a funding plan.
 *
 * Turns each per-wallet leg into an x402 settlement through the same pluggable
 * {@link Settler} the paying agent uses — a local ledger for runnable demos and
 * tests, or Circle programmable wallets for real testnet USDC. One funder pays
 * many maintainers in sub-cent amounts; the card-fee problem that kills "donate"
 * buttons never arises because the spine settles nanopayments for free.
 *
 * {@link toDistributorCall} produces the exact calldata shape the on-chain
 * RecursiveSplitDistributor consumes, so the same plan can instead be settled in
 * one atomic transaction on Arc.
 */

import { type Money, fromBaseUnits, money, toBaseUnits, uuid } from "@settlekit/common";
import { X402_SCHEME, type PaymentRequirements } from "@settlekit/x402";
import type { Settler } from "@settlekit/x402-client";
import type { FundingPlan, FundingReceipt, LegSettlement } from "./types.js";

/** Options for {@link settleFundingPlan}. */
export interface SettleOptions {
  /** Executes the USDC transfer for each leg (local ledger or Circle). */
  settler: Settler;
  /** The funder's wallet/address — the source of the budget. */
  from: string;
  /** Settlement network. Defaults to "arc". */
  network?: PaymentRequirements["network"];
  /** Product id used for attribution on the x402 challenge. */
  productId?: string;
  /**
   * Idempotency key identifying this plan settlement. When supplied, every leg's
   * x402 nonce is derived deterministically from it, so re-settling the same plan
   * (e.g. after a partial failure) reuses the same nonces — a nonce-tracking
   * verifier/settler then dedupes the already-paid legs instead of double-paying.
   * When omitted, each leg gets a fresh random nonce (suitable for one-shot demos).
   */
  idempotencyKey?: string;
}

/**
 * Settle every leg of a plan and reconcile it against the budget.
 *
 * Reconciliation is exact and per-leg: the receipt is `reconciled` only when
 * every leg settled for precisely its planned amount AND the total distributed
 * equals the budget. Checking only the aggregate total would let a settler that
 * paid the wrong wallets the wrong amounts (but summed correctly) pass — the
 * "no money created, none lost" guarantee has to hold leg by leg.
 */
export async function settleFundingPlan(
  plan: FundingPlan,
  options: SettleOptions,
): Promise<FundingReceipt> {
  const network = options.network ?? "arc";
  const productId = options.productId ?? "oss-fund";

  const settlements: LegSettlement[] = [];
  let distributedBase = 0n;
  let everyLegConserved = true;

  let index = 0;
  for (const leg of plan.legs) {
    const requirements: PaymentRequirements = {
      scheme: X402_SCHEME,
      amount: leg.amount.amount,
      asset: "USDC",
      network,
      payTo: leg.wallet,
      productId,
      resource: `oss-fund:${leg.packages.join(",")}`,
      nonce: legNonce(options.idempotencyKey, index, leg.wallet),
    };
    const proof = await options.settler.settle({ requirements, from: options.from });
    const settledBase = toBaseUnits(proof.amount);
    settlements.push({
      wallet: leg.wallet,
      amount: money(proof.amount),
      txHash: proof.txHash,
      packages: leg.packages,
    });
    distributedBase += settledBase;
    if (settledBase !== toBaseUnits(leg.amount.amount)) everyLegConserved = false;
    index += 1;
  }

  const distributed: Money = money(fromBaseUnits(distributedBase));
  const reconciled =
    everyLegConserved &&
    settlements.length === plan.legs.length &&
    distributedBase === toBaseUnits(plan.budget.amount);

  return { plan, settlements, distributed, reconciled };
}

/**
 * Per-leg x402 nonce. Deterministic when an idempotency key is provided (so a
 * retried plan reuses the same nonces and is dedupable), random otherwise.
 */
function legNonce(idempotencyKey: string | undefined, index: number, wallet: string): string {
  return idempotencyKey === undefined
    ? uuid()
    : `${idempotencyKey}:${index}:${wallet.toLowerCase()}`;
}

/** The on-chain settlement shape: recipients + integer base-unit amounts. */
export interface DistributorCall {
  /** Maintainer (and escrow) wallets, in leg order. */
  recipients: string[];
  /** Per-recipient amounts in USDC base units (6 dp), as decimal strings. */
  amounts: string[];
  /** Sum of `amounts` in base units, as a decimal string. */
  totalBase: string;
}

/**
 * Flatten a plan into the calldata `RecursiveSplitDistributor.distribute` takes,
 * settling the whole distribution atomically in a single on-chain transaction.
 */
export function toDistributorCall(plan: FundingPlan): DistributorCall {
  const recipients: string[] = [];
  const amounts: string[] = [];
  let totalBase = 0n;
  for (const leg of plan.legs) {
    const base = toBaseUnits(leg.amount.amount);
    if (base === 0n) continue;
    recipients.push(leg.wallet);
    amounts.push(base.toString());
    totalBase += base;
  }
  return { recipients, amounts, totalBase: totalBase.toString() };
}
