/**
 * Tool-trace conventions that make a DecisionRecord self-describing.
 *
 * Every record starts with an `event` entry (the triggering event) and holds
 * one `execute` entry per proposal the service acted on, so money flows can be
 * reconstructed from the hash-chained log alone (payment history, /proof).
 */
import type { ProposedAction } from "./actions.js";
import type { DecisionRecord, ToolCallRecord } from "./decision-log.js";
import type { OperatorEvent } from "./events.js";

export const EVENT_TRACE = "event";
export const EXECUTE_TRACE = "execute";
export const X402_TRACE = "x402_payment";

export type ExecutionStatus = "executed" | "escalated" | "denied" | "deferred" | "failed" | "blocked_on_chain";

export interface ExecutionResult {
  readonly status: ExecutionStatus;
  readonly txHash?: string;
  readonly escalationId?: string;
  readonly vaultEscalationId?: number;
  /** Vault custom error (blocked_on_chain) or failure message. */
  readonly error?: string;
}

export function eventTrace(event: OperatorEvent): ToolCallRecord {
  return { name: EVENT_TRACE, input: event };
}

export function executeTrace(action: ProposedAction, result: ExecutionResult): ToolCallRecord {
  return { name: EXECUTE_TRACE, input: action, output: result };
}

/** The triggering event stored on a record, if present. */
export function recordEvent(record: DecisionRecord): OperatorEvent | null {
  const entry = record.toolCalls.find((c) => c.name === EVENT_TRACE);
  return entry ? (entry.input as OperatorEvent) : null;
}

export interface ExecutedCall {
  readonly action: ProposedAction;
  readonly result: ExecutionResult;
}

export function recordExecutions(record: DecisionRecord): readonly ExecutedCall[] {
  return record.toolCalls
    .filter((c) => c.name === EXECUTE_TRACE && c.output !== undefined)
    .map((c) => ({ action: c.input as ProposedAction, result: c.output as ExecutionResult }));
}

export interface X402Spend {
  readonly payTo: string;
  readonly amount: bigint;
  readonly txHash: string;
}

/** Completed x402 purchases made while deciding. */
export function recordX402Spends(record: DecisionRecord): readonly X402Spend[] {
  return record.toolCalls.flatMap((c) => {
    if (c.name !== X402_TRACE) return [];
    const out = c.output as { status?: string; payTo?: string; price?: bigint; txHash?: string } | undefined;
    if (!out || out.status !== "purchased" || typeof out.price !== "bigint" || !out.payTo || !out.txHash) return [];
    return [{ payTo: out.payTo, amount: out.price, txHash: out.txHash }];
  });
}

/** Outgoing payee + amount for an action that moves USDC out of the vault. */
export function outflow(action: ProposedAction): { readonly to: string; readonly amount: bigint; readonly kind: string } | null {
  switch (action.kind) {
    case "payout":
      return { to: action.to, amount: action.amount, kind: "payout" };
    case "refund":
      return { to: action.to, amount: action.amount, kind: "refund" };
    case "escalate":
      return action.subject ? outflow(action.subject) : null;
    default:
      return null;
  }
}
