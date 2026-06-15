/**
 * Invoice line items + exact line/subtotal math.
 *
 * A line's amount is `unitAmount * quantity`, computed with the integer-safe
 * `multiplyMoney` from `@settlekit/common` — never `Number()` / float math.
 * The subtotal is the running `addMoney` of every line.
 */
import { addMoney, money, multiplyMoney, type Money } from "@settlekit/common";

/** One billable line on an invoice. */
export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: Money;
}

/** The exact total for a single line (`unitAmount * quantity`). */
export function lineItemAmount(item: InvoiceLineItem): Money {
  return multiplyMoney(item.unitAmount, item.quantity);
}

/**
 * Sum every line into a subtotal Money. An empty invoice subtotals to zero in
 * `currency` (default USDC). Mixing currencies throws via `addMoney`.
 */
export function computeSubtotal(
  lineItems: readonly InvoiceLineItem[],
  currency: Money["currency"] = "USDC",
): Money {
  return lineItems.reduce<Money>(
    (sum, item) => addMoney(sum, lineItemAmount(item)),
    money("0", currency),
  );
}
