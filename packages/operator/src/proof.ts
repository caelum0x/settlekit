/**
 * Public traction proof computed from the hash-chained decision logs:
 * distinct orgs and counterparties, USDC in/out, decisions by outcome
 * (including blocked by policy and blocked on-chain), latency and model cost.
 * The `demo` org (seed data) is always excluded.
 */
import type { DecisionRecord } from "./decision-log.js";
import { movementsOf } from "./history.js";
import type { OperatorStore } from "./store.js";
import { recordExecutions } from "./trace.js";
import { formatUsdc } from "./usdc.js";

export const DEMO_ORG_ID = "demo";
const PAGE = 1000;

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
}

/** Every decision for an org, paging through the store. */
export async function allDecisions(store: OperatorStore, orgId: string): Promise<readonly DecisionRecord[]> {
  const out: DecisionRecord[] = [];
  for (let after = -1; ; ) {
    const page = await store.listDecisions(orgId, { afterSeq: after, limit: PAGE });
    out.push(...page);
    if (page.length < PAGE) return out;
    after = (page[page.length - 1] as DecisionRecord).seq;
  }
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] as number;
}

export interface ProofOptions {
  readonly now?: Date;
  readonly excludeOrgs?: readonly string[];
  readonly explorerUrl?: string;
  readonly recent?: number;
}

export async function computeProof(store: OperatorStore, options: ProofOptions = {}): Promise<OperatorProof> {
  const excluded = new Set([DEMO_ORG_ID, ...(options.excludeOrgs ?? [])]);
  const orgs = (await store.listOrgIds()).filter((o) => !excluded.has(o));
  const records = (await Promise.all(orgs.map((o) => allDecisions(store, o)))).flat();

  const movements = records.flatMap(movementsOf);
  const sum = (dir: "in" | "out"): bigint => movements.filter((m) => m.direction === dir).reduce((a, m) => a + m.amount, 0n);
  const count = (outcome: string): number => records.filter((r) => r.outcome === outcome).length;
  const statuses = (r: DecisionRecord) => recordExecutions(r).map((e) => e.result.status);
  const byModel = records.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.model]: (acc[r.model] ?? 0) + 1 }), {});
  const latencies = records.flatMap((r) => (typeof r.latencyMs === "number" ? [r.latencyMs] : [])).sort((a, b) => a - b);
  const llm = records.filter((r) => r.usage !== undefined);
  const totalUsd = llm.reduce((a, r) => a + (r.usage?.costUsd ?? 0), 0);
  const explorer = options.explorerUrl?.replace(/\/+$/, "");
  const anchors = records
    .filter((r) => r.txHash)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, options.recent ?? 10)
    .map((r): ProofAnchor => ({
      decisionId: r.id,
      txHash: r.txHash as string,
      outcome: r.outcome,
      createdAt: r.createdAt,
      ...(explorer ? { explorerUrl: `${explorer}/tx/${r.txHash}` } : {}),
    }));

  return {
    orgs: orgs.length,
    counterparties: new Set(movements.map((m) => m.counterparty.toLowerCase())).size,
    usdcIn: formatUsdc(sum("in")),
    usdcOut: formatUsdc(sum("out")),
    decisions: {
      total: records.length,
      executed: count("executed"),
      escalated: count("escalated"),
      denied: count("denied"),
      deferred: count("deferred"),
      failed: count("failed"),
      blockedByPolicy: records.filter((r) => r.policyVerdict?.decision === "deny" || statuses(r).includes("denied")).length,
      blockedOnChain: records.filter((r) => statuses(r).includes("blocked_on_chain")).length,
      byModel,
    },
    latencyMs: {
      avg: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
    modelCost: {
      totalUsd: Math.round(totalUsd * 1e6) / 1e6,
      perLlmDecisionUsd: llm.length ? Math.round((totalUsd / llm.length) * 1e6) / 1e6 : 0,
      llmDecisions: llm.length,
    },
    recentAnchors: anchors,
    generatedAt: (options.now ?? new Date()).toISOString(),
  };
}
