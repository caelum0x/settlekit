/**
 * Turning accepted proposals into vault transactions and escalations.
 *
 * Denied verdicts never reach the vault. Off-chain escalations and explicit
 * `escalate` proposals open an escalation for the owner. Vault escalations
 * (amount above `escalateAbove`) are sent: the vault parks the funds as
 * Pending and the returned id is stored on the escalation. Vault reverts are
 * recorded as `blocked_on_chain` with the custom error name.
 */
import type { Proposal } from "./actions.js";
import type { EscalationQueue } from "./escalation.js";
import { executeProposal, VaultError, type OperatorExecutor, type PayResult, type TxResult } from "./executor.js";
import type { ExecutionResult } from "./trace.js";

export interface ExecutionContext {
  readonly orgId: string;
  readonly decisionId: string;
  readonly anchorHash: string;
  readonly executor: OperatorExecutor;
  readonly escalations: EscalationQueue;
  readonly newId: () => string;
}

const EXECUTABLE = new Set(["allocate", "payout", "refund", "sweep_to_yield", "redeem_from_yield"]);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function openEscalation(ctx: ExecutionContext, p: Proposal, reasons: readonly string[], vaultEscalationId?: number): Promise<ExecutionResult> {
  const e = await ctx.escalations.open({
    id: ctx.newId(),
    orgId: ctx.orgId,
    decisionId: ctx.decisionId,
    proposal: p,
    reasons,
    ...(vaultEscalationId !== undefined ? { vaultEscalationId } : {}),
  });
  return { status: "escalated", escalationId: e.id, ...(vaultEscalationId !== undefined ? { vaultEscalationId } : {}) };
}

async function sendToVault(ctx: ExecutionContext, p: Proposal): Promise<ExecutionResult> {
  let tx: TxResult | PayResult | null;
  try {
    tx = await executeProposal(ctx.executor, ctx.anchorHash, p);
  } catch (error) {
    if (error instanceof VaultError) return { status: "blocked_on_chain", error: error.code };
    return { status: "failed", error: errorText(error) };
  }
  if (!tx) return { status: "deferred" };
  if ("status" in tx && tx.status === "escalated") {
    const reasons = p.verdict?.reasons ?? ["above_escalation_threshold"];
    const opened = await openEscalation(ctx, p, reasons, tx.escalationId);
    return { ...opened, txHash: tx.txHash };
  }
  return { status: "executed", txHash: tx.txHash };
}

/** Execute or route one proposal. Never throws for vault/engine failures. */
export async function carryOut(ctx: ExecutionContext, p: Proposal): Promise<ExecutionResult> {
  const { action, verdict } = p;
  switch (action.kind) {
    case "escalate":
      return openEscalation(ctx, p, [action.reason, ...(verdict?.reasons ?? [])]);
    case "decline":
      return { status: "denied", error: action.reason };
    case "defer":
      return { status: "deferred", error: action.reason };
    default:
      break;
  }
  if (!EXECUTABLE.has(action.kind)) return { status: "deferred" };
  if (verdict?.decision === "deny") return { status: "denied", error: verdict.reasons.join(", ") };
  if (verdict?.decision === "escalate" && verdict.escalation !== "vault") {
    return openEscalation(ctx, p, verdict.reasons);
  }
  return sendToVault(ctx, p);
}

export type DecisionOutcomeFromResults = "executed" | "escalated" | "denied" | "deferred" | "failed";

/** Most significant outcome across all results. */
export function aggregateOutcome(results: readonly ExecutionResult[]): DecisionOutcomeFromResults {
  const has = (...s: ExecutionResult["status"][]): boolean => results.some((r) => s.includes(r.status));
  if (has("failed", "blocked_on_chain")) return "failed";
  if (has("escalated")) return "escalated";
  if (has("executed")) return "executed";
  if (has("denied")) return "denied";
  return "deferred";
}
