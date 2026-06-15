import { addMoney, type Money } from "@settlekit/common";

export interface LedgerEntry {
  accountId: string;
  direction: "debit" | "credit";
  amount: Money;
  memo: string;
}

export function accountBalance(entries: LedgerEntry[], accountId: string): Money {
  return entries.filter((entry) => entry.accountId === accountId).reduce((balance, entry) => {
    return entry.direction === "credit"
      ? addMoney(balance, entry.amount)
      : addMoney(balance, { amount: `-${entry.amount.amount}`, currency: entry.amount.currency });
  }, { amount: "0", currency: "USDC" } as Money);
}

export function ledgerBalances(entries: LedgerEntry[]): Record<string, Money> {
  return [...new Set(entries.map((entry) => entry.accountId))].reduce<Record<string, Money>>((balances, accountId) => {
    balances[accountId] = accountBalance(entries, accountId);
    return balances;
  }, {});
}
