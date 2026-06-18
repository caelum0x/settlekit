/**
 * Spending-cap enforcement: per-transaction and per-UTC-day limits, plus the
 * wallet kill-switch. Tracks spend in USDC base units; `authorize` is checked
 * before every transfer and `record` is called after one settles.
 */

import { type Money, fromBaseUnits, money, toBaseUnits } from "@settlekit/common";
import type { FleetWallet, SpendAuthorization, SpendingCaps } from "./types.js";

function dayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export class SpendingCapEnforcer {
  private readonly spendByDay = new Map<string, bigint>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  private key(walletId: string, at: number): string {
    return `${walletId}|${dayKey(at)}`;
  }

  spentTodayUsdc(walletId: string, at: number = this.now()): string {
    return fromBaseUnits(this.spendByDay.get(this.key(walletId, at)) ?? 0n);
  }

  /** Decide whether a spend is allowed under the wallet's caps. */
  authorize(
    wallet: FleetWallet,
    caps: SpendingCaps,
    amount: Money,
    at: number = this.now(),
  ): SpendAuthorization {
    if (wallet.killed) {
      return { allowed: false, reason: "wallet killed" };
    }
    const amountBase = toBaseUnits(amount.amount);
    if (amountBase <= 0n) {
      return { allowed: false, reason: "amount must be positive" };
    }
    if (caps.perTxUsdc !== undefined && amountBase > toBaseUnits(money(caps.perTxUsdc).amount)) {
      return { allowed: false, reason: `exceeds per-tx cap ${caps.perTxUsdc} USDC` };
    }
    if (caps.perDayUsdc !== undefined) {
      const dayCapBase = toBaseUnits(money(caps.perDayUsdc).amount);
      const spentBase = this.spendByDay.get(this.key(wallet.id, at)) ?? 0n;
      if (spentBase + amountBase > dayCapBase) {
        return { allowed: false, reason: `exceeds daily cap ${caps.perDayUsdc} USDC` };
      }
    }
    return { allowed: true };
  }

  /** Record a settled spend against the wallet's daily total. */
  record(walletId: string, amount: Money, at: number = this.now()): void {
    const key = this.key(walletId, at);
    this.spendByDay.set(key, (this.spendByDay.get(key) ?? 0n) + toBaseUnits(amount.amount));
  }
}
