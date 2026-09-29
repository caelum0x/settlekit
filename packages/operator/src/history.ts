/**
 * Payment history reconstructed from the hash-chained decision log: revenue
 * events are inflows, executed payouts/refunds and x402 purchases outflows.
 * Because it reads only the log, history is as tamper-evident as the chain.
 */
import type { PaymentHistory, PaymentHistoryEntry } from "./context.js";
import type { DecisionRecord } from "./decision-log.js";
import type { OperatorStore } from "./store.js";
import { outflow, recordEvent, recordExecutions, recordX402Spends } from "./trace.js";

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Every money movement recorded in one decision. */
export function movementsOf(record: DecisionRecord): readonly PaymentHistoryEntry[] {
  const base = { decisionId: record.id, at: record.createdAt };
  const event = recordEvent(record);
  const inflow: PaymentHistoryEntry[] =
    event && event.type === "revenue.received"
      ? [{ ...base, direction: "in", counterparty: event.payer, amount: event.amount, kind: "revenue", txHash: event.paymentRef }]
      : [];
  const out = recordExecutions(record).flatMap(({ action, result }) => {
    const flow = outflow(action);
    if (!flow || result.status !== "executed") return [];
    const entry: PaymentHistoryEntry = { ...base, direction: "out", counterparty: flow.to, amount: flow.amount, kind: flow.kind, txHash: result.txHash };
    return [entry];
  });
  const x402 = recordX402Spends(record).map(
    (s): PaymentHistoryEntry => ({ ...base, direction: "out", counterparty: s.payTo, amount: s.amount, kind: "x402", txHash: s.txHash }),
  );
  return [...inflow, ...out, ...x402];
}

export function createStoreHistory(store: OperatorStore): PaymentHistory {
  return {
    async list(orgId, counterparty, limit = 50) {
      const records = await store.listDecisions(orgId);
      const all = records.flatMap(movementsOf);
      const filtered = counterparty ? all.filter((e) => same(e.counterparty, counterparty)) : all;
      return filtered.slice(-limit).reverse();
    },
  };
}
