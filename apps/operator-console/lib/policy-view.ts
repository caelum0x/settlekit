/**
 * Side-by-side view of the off-chain operator policy and the on-chain
 * OperatorVault configuration, with a per-row drift indicator.
 */
import { formatUsdc } from "./format";
import type { OperatorStateView, PolicyResponse } from "./types";

export type RowStatus = "match" | "drift" | "off_chain_only" | "unknown";

export interface PolicyRow {
  readonly label: string;
  readonly offChain: string;
  readonly onChain: string;
  readonly status: RowStatus;
}

const usd = (v: string): string => `${formatUsdc(v)} USDC`;
const bps = (v: number): string => `${v / 100}%`;

/** Compare decimal USDC strings exactly (no floats). */
export function sameUsdc(a: string, b: string): boolean {
  const norm = (v: string) => {
    const [w = "0", f = ""] = v.trim().split(".");
    return `${BigInt(w)}.${f.replace(/0+$/, "")}`;
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

export function policyRows(res: PolicyResponse, state: OperatorStateView | null): readonly PolicyRow[] {
  const p = res.policy;
  const caps = state?.caps ?? null;
  const cap = (label: string, key: "perTxCap" | "dailyCap" | "escalateAbove"): PolicyRow => ({
    label,
    offChain: usd(p[key]),
    onChain: caps ? usd(caps[key]) : "unavailable",
    status: caps ? (sameUsdc(p[key], caps[key]) ? "match" : "drift") : "unknown",
  });
  const drifted = new Set(
    res.drift.map((d) => /^(0x[a-fA-F0-9]{40}) is not allowlisted on-chain$/.exec(d)?.[1]?.toLowerCase()).filter((a): a is string => Boolean(a)),
  );
  const allowRows: PolicyRow[] = p.allowlist.map((a) => ({
    label: `Allowlisted payee ${a}`,
    offChain: "allowed",
    onChain: drifted.has(a.toLowerCase()) ? "not allowlisted" : res.vault ? "allowlisted" : "no vault",
    status: drifted.has(a.toLowerCase()) ? "drift" : res.vault ? "match" : "unknown",
  }));
  const offOnly = (label: string, value: string): PolicyRow => ({ label, offChain: value, onChain: "enforced off-chain", status: "off_chain_only" });
  return [
    cap("Per-payment cap", "perTxCap"),
    cap("Daily cap", "dailyCap"),
    cap("Escalate above", "escalateAbove"),
    ...allowRows,
    offOnly("Tax reserve", bps(p.taxRateBps)),
    offOnly("Split: operating / yield / refund", `${bps(p.split.OPERATING)} / ${bps(p.split.YIELD)} / ${bps(p.split.REFUND)}`),
    offOnly("Minimum operating float", usd(p.minFloat)),
    offOnly("Yield target", usd(p.yieldTarget)),
    offOnly("x402 purchases per day", String(p.maxX402PerDay)),
  ];
}

export function hasDrift(res: PolicyResponse, rows: readonly PolicyRow[]): boolean {
  return res.drift.length > 0 || rows.some((r) => r.status === "drift");
}
