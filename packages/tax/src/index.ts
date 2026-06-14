import { addMoney, fromBaseUnits, money, toBaseUnits, type Money } from "@settlekit/common";

export interface TaxRate {
  jurisdiction: string;
  rateBps: number;
  inclusive: boolean;
}

export interface TaxCalculation {
  subtotal: Money;
  tax: Money;
  total: Money;
  jurisdiction: string;
}

export function calculateTax(subtotal: Money, rate: TaxRate): TaxCalculation {
  const taxBase = (toBaseUnits(subtotal.amount) * BigInt(rate.rateBps)) / 10_000n;
  const tax = money(fromBaseUnits(taxBase), subtotal.currency);
  const total = rate.inclusive ? subtotal : addMoney(subtotal, tax);
  return { subtotal, tax, total, jurisdiction: rate.jurisdiction };
}

export function taxExemptCalculation(subtotal: Money, jurisdiction = "exempt"): TaxCalculation {
  return { subtotal, tax: money("0", subtotal.currency), total: subtotal, jurisdiction };
}
