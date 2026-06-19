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
}

/** Settle every leg of a plan and reconcile the total against the budget. */
export async function settleFundingPlan(
  plan: FundingPlan,
  options: SettleOptions,
): Promise<FundingReceipt> {
  const network = options.network ?? "arc";
  const productId = options.productId ?? "oss-fund";

  const settlements: LegSettlement[] = [];
  let distributedBase = 0n;

  for (const leg of plan.legs) {
    const requirements: PaymentRequirements = {
      scheme: X402_SCHEME,
      amount: leg.amount.amount,
      asset: "USDC",
      network,
      payTo: leg.wallet,
      productId,
      resource: `oss-fund:${leg.packages.join(",")}`,
      nonce: uuid(),
    };
    const proof = await options.settler.settle({ requirements, from: options.from });
    settlements.push({
      wallet: leg.wallet,
      amount: money(proof.amount),
      txHash: proof.txHash,
      packages: leg.packages,
    });
    distributedBase += toBaseUnits(proof.amount);
  }

  const distributed: Money = money(fromBaseUnits(distributedBase));
  const reconciled =
    settlements.length === plan.legs.length && distributed.amount === plan.budget.amount;

  return { plan, settlements, distributed, reconciled };
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
