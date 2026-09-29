/**
 * View model for the public /proof page: turns the API's proof aggregates
 * and per-decision verifications into labelled tiles, an outcome breakdown
 * and recent decisions with Arcscan links and anchored status.
 */
import { formatDuration, formatPercent, formatUsd, formatUsdc, shortHash, txUrl } from "./format";
import type { DecisionVerification, OperatorProof } from "./types";

export interface Tile {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}

export interface OutcomeRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly share: string;
}

export type AnchorStatus = "anchored" | "missing_anchor" | "not_found" | "reverted" | "not_configured" | "unverified";

export interface RecentRow {
  readonly decisionId: string;
  readonly outcome: string;
  readonly createdAt: string;
  readonly txHash: string;
  readonly txLabel: string;
  readonly txUrl: string;
  readonly anchor: AnchorStatus;
  readonly anchorLabel: string;
  readonly chainValid: boolean | null;
}

export interface ProofView {
  readonly networkLabel: string;
  readonly isSimulation: boolean;
  readonly tiles: readonly Tile[];
  readonly outcomes: readonly OutcomeRow[];
  readonly recent: readonly RecentRow[];
  readonly models: readonly { readonly model: string; readonly count: number }[];
  readonly generatedAt: string;
  readonly vault: string | null;
}

const ANCHOR_LABELS: Readonly<Record<AnchorStatus, string>> = {
  anchored: "Anchored on Arc",
  missing_anchor: "Tx found, anchor missing",
  not_found: "Tx not found",
  reverted: "Tx reverted",
  not_configured: "No vault configured",
  unverified: "Not verified yet",
};

/** Collapse a decision verification into one anchored status. */
export function anchorStatus(verification: DecisionVerification | null | undefined): AnchorStatus {
  if (!verification) return "unverified";
  if (verification.onChain === "not_configured") return "not_configured";
  const statuses = verification.onChain.map((c) => c.status);
  if (statuses.length === 0) return "unverified";
  for (const bad of ["reverted", "not_found", "missing_anchor"] as const) {
    if (statuses.includes(bad)) return bad;
  }
  return "anchored";
}

export function anchorLabel(status: AnchorStatus): string {
  return ANCHOR_LABELS[status];
}

function share(count: number, total: number): string {
  return total > 0 ? formatPercent(count / total) : "0%";
}

export function formatProof(
  proof: OperatorProof,
  explorerUrl: string,
  verifications: Readonly<Record<string, DecisionVerification | null>> = {},
): ProofView {
  const d = proof.decisions;
  const outcomes: OutcomeRow[] = [
    { key: "executed", label: "Executed autonomously", count: d.executed },
    { key: "escalated", label: "Escalated to a human", count: d.escalated },
    { key: "blockedByPolicy", label: "Blocked by policy", count: d.blockedByPolicy },
    { key: "blockedOnChain", label: "Blocked on-chain by the vault", count: d.blockedOnChain },
    { key: "denied", label: "Denied", count: d.denied },
    { key: "deferred", label: "Deferred", count: d.deferred },
    { key: "failed", label: "Failed", count: d.failed },
  ].map((row) => ({ ...row, share: share(row.count, d.total) }));

  const tiles: Tile[] = [
    { label: "Organizations", value: String(proof.orgs), hint: "Distinct orgs with decisions (demo org excluded)" },
    { label: "Counterparties", value: String(proof.counterparties), hint: "Distinct payers and payees" },
    { label: "USDC in", value: `${formatUsdc(proof.usdcIn)} USDC` },
    { label: "USDC out", value: `${formatUsdc(proof.usdcOut)} USDC` },
    { label: "Decisions", value: String(d.total) },
    { label: "Median latency", value: formatDuration(proof.latencyMs.p50), hint: `p95 ${formatDuration(proof.latencyMs.p95)}` },
    {
      label: "Model cost per decision",
      value: formatUsd(proof.modelCost.perLlmDecisionUsd),
      hint: `${proof.modelCost.llmDecisions} Claude decisions, ${formatUsd(proof.modelCost.totalUsd)} total`,
    },
  ];

  const recent: RecentRow[] = proof.recentAnchors.map((a) => {
    const verification = verifications[a.decisionId];
    const status = anchorStatus(verification);
    return {
      decisionId: a.decisionId,
      outcome: a.outcome,
      createdAt: a.createdAt,
      txHash: a.txHash,
      txLabel: shortHash(a.txHash),
      txUrl: a.explorerUrl ?? txUrl(explorerUrl, a.txHash),
      anchor: status,
      anchorLabel: anchorLabel(status),
      chainValid: verification ? verification.chain.valid : null,
    };
  });

  const models = Object.entries(d.byModel)
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count);

  return {
    networkLabel: proof.network === "arc-testnet" ? "Arc testnet" : proof.network,
    isSimulation: proof.executor === "local-simulation",
    tiles,
    outcomes,
    recent,
    models,
    generatedAt: proof.generatedAt,
    vault: proof.vault,
  };
}

/** Verify each recent anchor; failures leave that row "unverified". */
export async function verifyRecent(
  proof: OperatorProof,
  verify: (decisionId: string) => Promise<DecisionVerification>,
): Promise<Record<string, DecisionVerification | null>> {
  const ids = [...new Set(proof.recentAnchors.map((a) => a.decisionId))];
  const results = await Promise.allSettled(ids.map((id) => verify(id)));
  return Object.fromEntries(ids.map((id, i) => {
    const r = results[i];
    return [id, r && r.status === "fulfilled" ? r.value : null];
  }));
}
