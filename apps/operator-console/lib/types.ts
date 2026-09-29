/**
 * JSON shapes returned by the SettleKit operator API. Money is USDC: decision
 * payloads carry base units (6 dp) as decimal strings; state, policy and
 * proof carry decimal USDC strings.
 */

export type Bucket = "OPERATING" | "TAX" | "YIELD" | "REFUND";
export const BUCKETS: readonly Bucket[] = ["OPERATING", "TAX", "YIELD", "REFUND"];

export type ExecutorKind = "circle-dcw" | "viem-signer" | "local-simulation";

export interface OperatorStateView {
  readonly orgId: string;
  readonly buckets: Readonly<Record<Bucket, string>>;
  readonly total: string;
  readonly unallocated: string;
  readonly pendingReserved: string;
  readonly yieldDeployed: string;
  readonly yieldEnabled: boolean;
  readonly paused: boolean;
  readonly spentToday: string;
  readonly caps: Readonly<{ perTxCap: string; dailyCap: string; escalateAbove: string }>;
  readonly dailyCapUsed: number;
  readonly pendingEscalations: number;
  readonly asOf: string;
  readonly executor: ExecutorKind;
  readonly vault: string | null;
  readonly explorerUrl: string;
}

export interface ToolCall {
  readonly name: string;
  readonly input: unknown;
  readonly output?: unknown;
}

export interface PolicyVerdictView {
  readonly decision: "allow" | "escalate" | "deny";
  readonly reasons: readonly string[];
  readonly escalation?: "vault" | "offchain";
  readonly spentToday: string;
}

export type DecisionOutcome = "executed" | "escalated" | "denied" | "deferred" | "failed";

export interface DecisionView {
  readonly id: string;
  readonly orgId: string;
  readonly eventRef: string;
  readonly model: string;
  readonly inputsDigest: string;
  readonly toolCalls: readonly ToolCall[];
  readonly policyVerdict: PolicyVerdictView | null;
  readonly rationale: string;
  readonly alternatives: readonly string[];
  readonly confidence: number;
  readonly outcome: DecisionOutcome;
  readonly txHash?: string;
  readonly txHashes?: readonly string[];
  readonly anchorHash?: string;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly costUsd: number };
  readonly latencyMs?: number;
  readonly createdAt: string;
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

export type EscalationStatus = "pending" | "approved" | "rejected" | "expired";

export interface EscalationView {
  readonly id: string;
  readonly orgId: string;
  readonly decisionId: string;
  readonly proposal: { readonly action: Record<string, unknown>; readonly rationale?: string; readonly [key: string]: unknown };
  readonly reasons: readonly string[];
  readonly status: EscalationStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly vaultEscalationId?: number;
  readonly resolvedAt?: string;
  readonly resolvedBy?: string;
  readonly resolution?: string;
}

export type BillStatus = "open" | "paid" | "escalated" | "rejected";

export interface BillView {
  readonly id: string;
  readonly orgId: string;
  readonly payee: string;
  /** USDC base units as a decimal string. */
  readonly amount: string;
  readonly dueAt: string;
  readonly description: string;
  readonly status: BillStatus;
  readonly createdAt: string;
}

export interface BillIntakeResult {
  readonly bill: BillView;
  readonly decision: DecisionView | null;
  readonly [key: string]: unknown;
}

export interface PolicyView {
  readonly split: Readonly<{ OPERATING: number; YIELD: number; REFUND: number }>;
  readonly taxRateBps: number;
  readonly perTxCap: string;
  readonly dailyCap: string;
  readonly escalateAbove: string;
  readonly minFloat: string;
  readonly yieldTarget: string;
  readonly allowlist: readonly string[];
  readonly maxX402PerDay: number;
}

export interface PolicyResponse {
  readonly policy: PolicyView;
  readonly drift: readonly string[];
  readonly executor: ExecutorKind;
  readonly engine: string;
  readonly vault: string | null;
}

export interface ProofAnchor {
  readonly decisionId: string;
  readonly txHash: string;
  readonly outcome: string;
  readonly createdAt: string;
  readonly explorerUrl?: string;
}

export interface OperatorProof {
  readonly orgs: number;
  readonly counterparties: number;
  readonly usdcIn: string;
  readonly usdcOut: string;
  readonly decisions: {
    readonly total: number;
    readonly executed: number;
    readonly escalated: number;
    readonly denied: number;
    readonly deferred: number;
    readonly failed: number;
    readonly blockedByPolicy: number;
    readonly blockedOnChain: number;
    readonly byModel: Readonly<Record<string, number>>;
  };
  readonly latencyMs: { readonly avg: number; readonly p50: number; readonly p95: number };
  readonly modelCost: { readonly totalUsd: number; readonly perLlmDecisionUsd: number; readonly llmDecisions: number };
  readonly recentAnchors: readonly ProofAnchor[];
  readonly generatedAt: string;
  readonly network: string;
  readonly executor: ExecutorKind;
  readonly vault: string | null;
}

export interface OnChainCheck {
  readonly txHash: string;
  readonly status: "anchored" | "missing_anchor" | "not_found" | "reverted";
  readonly actions: readonly string[];
  readonly explorerUrl?: string;
}

export interface DecisionVerification {
  readonly decisionId: string;
  readonly orgId: string;
  readonly chain: { readonly valid: boolean; readonly checked: number; readonly brokenAt?: number; readonly reason?: string };
  readonly hash: string;
  readonly anchorHash: string | null;
  readonly commitment: "match" | "mismatch" | "owner_reanchor" | "not_anchored";
  readonly onChain: readonly OnChainCheck[] | "not_configured";
  readonly valid: boolean;
}
