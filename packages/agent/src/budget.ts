/**
 * A spend tracker for one agent run. Holds the running total in USDC base units
 * and answers affordability questions against the policy's total budget.
 *
 * This is a stateful session object (like a ledger): `record` accumulates spend.
 * All reads project immutable {@link Money} values.
 */

import { type Money, fromBaseUnits, money, toBaseUnits } from "@settlekit/common";

export class BudgetTracker {
  private readonly totalBase: bigint;
  private spentBase = 0n;

  constructor(totalBudgetUsdc: string) {
    this.totalBase = toBaseUnits(money(totalBudgetUsdc).amount);
  }

  get total(): Money {
    return money(fromBaseUnits(this.totalBase));
  }

  get spent(): Money {
    return money(fromBaseUnits(this.spentBase));
  }

  get remaining(): Money {
    const rem = this.totalBase - this.spentBase;
    return money(fromBaseUnits(rem > 0n ? rem : 0n));
  }

  /** Whether spending `amount` would stay within the total budget. */
  canAfford(amount: Money): boolean {
    return this.spentBase + toBaseUnits(amount.amount) <= this.totalBase;
  }

  /** Accumulate a confirmed spend. */
  record(amount: Money): void {
    this.spentBase += toBaseUnits(amount.amount);
  }
}
