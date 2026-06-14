import { addMoney, money, type Money } from "@settlekit/common";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: Money;
}

export interface Invoice {
  number: string;
  customerId: string;
  lineItems: InvoiceLineItem[];
  total: Money;
  status: "draft" | "open" | "paid" | "void";
}

export function invoiceNumber(prefix: string, sequence: number): string {
  return `${prefix}-${sequence.toString().padStart(6, "0")}`;
}

export function createInvoice(customerId: string, number: string, lineItems: InvoiceLineItem[]): Invoice {
  const total = lineItems.reduce((sum, item) => addMoney(sum, { amount: (Number(item.unitAmount.amount) * item.quantity).toString(), currency: item.unitAmount.currency }), money("0"));
  return { customerId, number, lineItems, total, status: "draft" };
}
