import { addMoney, generateId, money, type Money } from "@settlekit/common";

export interface PayoutBatchItem {
  merchantId: string;
  walletAddress: string;
  amount: Money;
}

export interface PayoutBatch {
  id: string;
  network: "arc" | "base" | "ethereum";
  items: PayoutBatchItem[];
  total: Money;
  status: "created" | "submitted" | "settled" | "failed";
  createdAt: string;
}

export function createPayoutBatch(network: PayoutBatch["network"], items: PayoutBatchItem[], now = new Date()): PayoutBatch {
  const total = items.reduce((sum, item) => addMoney(sum, item.amount), money("0"));
  return { id: generateId("payoutWallet"), network, items, total, status: "created", createdAt: now.toISOString() };
}

export function markPayoutBatchSubmitted(batch: PayoutBatch): PayoutBatch {
  return { ...batch, status: "submitted" };
}
