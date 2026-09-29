/** Decision-log helpers for the console (pure over the API client). */
import type { OperatorApiClient } from "./api-client";
import { baseUnitsToUsdc } from "./format";
import type { DecisionView, ToolCall } from "./types";

export const PAGE_SIZE = 500;
export const MAX_SCAN = 5_000;

/** The newest `count` decisions, newest first (pages through the chain). */
export async function latestDecisions(api: Pick<OperatorApiClient, "decisions">, count: number): Promise<readonly DecisionView[]> {
  let all: readonly DecisionView[] = [];
  let after = -1;
  while (all.length < MAX_SCAN) {
    const page = await api.decisions({ afterSeq: after, limit: PAGE_SIZE });
    all = [...all, ...page].slice(-count);
    if (page.length < PAGE_SIZE) break;
    after = (page[page.length - 1] as DecisionView).seq;
  }
  return [...all].reverse();
}

/** Every tx hash a decision produced, first one first, deduplicated. */
export function decisionTxHashes(d: Pick<DecisionView, "txHash" | "txHashes">): readonly string[] {
  return [...new Set([...(d.txHash ? [d.txHash] : []), ...(d.txHashes ?? [])])];
}

export interface TraceStep {
  readonly index: number;
  readonly name: string;
  readonly input: string;
  readonly output: string | null;
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Tool trace rendered as JSON text blocks. */
export function traceSteps(calls: readonly ToolCall[]): readonly TraceStep[] {
  return calls.map((c, index) => ({ index: index + 1, name: c.name, input: pretty(c.input), output: c.output === undefined ? null : pretty(c.output) }));
}

/** Short human summary of the action a decision (or escalation) proposed. */
export function describeAction(action: Record<string, unknown> | undefined): string {
  if (!action) return "No action";
  const amount = (v: unknown) => (typeof v === "string" || typeof v === "number" ? `${baseUnitsToUsdc(v)} USDC` : "?");
  switch (action.kind) {
    case "payout":
      return `Pay ${amount(action.amount)} from ${String(action.bucket)} to ${String(action.to)}`;
    case "refund":
      return `Refund ${amount(action.amount)} to ${String(action.to)}`;
    case "allocate":
      return "Allocate inflow across buckets";
    case "sweep_to_yield":
      return `Sweep ${amount(action.amount)} to yield`;
    case "redeem_from_yield":
      return `Redeem ${amount(action.amount)} from yield`;
    case "escalate":
      return `Escalate: ${String(action.reason)}`;
    case "decline":
      return `Decline: ${String(action.reason)}`;
    case "defer":
      return `Defer: ${String(action.reason)}`;
    default:
      return String(action.kind ?? "Unknown action");
  }
}
