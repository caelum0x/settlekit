import type { ReactNode } from "react";
import { shortHash, txUrl } from "@/lib/format";

export interface StatProps {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}

export function Stat({ label, value, hint }: StatProps) {
  return (
    <div className="card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  );
}

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

export function Badge({ tone = "neutral", children }: { readonly tone?: Tone; readonly children: ReactNode }) {
  const cls = tone === "neutral" ? "badge" : `badge badge-${tone}`;
  return <span className={cls}>{children}</span>;
}

export function Notice({ tone = "warn", title, children }: { readonly tone?: "warn" | "bad" | "ok"; readonly title?: string; readonly children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : "status"}>
      {title ? <strong>{title} </strong> : null}
      {children}
    </div>
  );
}

export function PageHeader({ title, lead }: { readonly title: string; readonly lead?: ReactNode }) {
  return (
    <header>
      <h1>{title}</h1>
      {lead ? <p className="lead">{lead}</p> : null}
    </header>
  );
}

export function Meter({ value, label }: { readonly value: number; readonly label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const tone = pct >= 90 ? " meter-bad" : pct >= 70 ? " meter-warn" : "";
  return (
    <div className={`meter${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TxLink({ explorerUrl, hash }: { readonly explorerUrl: string; readonly hash: string }) {
  return (
    <a className="mono" href={txUrl(explorerUrl, hash)} target="_blank" rel="noreferrer noopener" title={hash}>
      {shortHash(hash)}
      <span className="sr-only"> (opens Arcscan)</span>
    </a>
  );
}

const OUTCOME_TONES: Readonly<Record<string, Tone>> = {
  executed: "ok",
  escalated: "warn",
  denied: "bad",
  failed: "bad",
  deferred: "neutral",
  pending: "warn",
  approved: "ok",
  rejected: "bad",
  expired: "neutral",
  paid: "ok",
  open: "info",
};

export function OutcomeBadge({ outcome }: { readonly outcome: string }) {
  return <Badge tone={OUTCOME_TONES[outcome] ?? "neutral"}>{outcome}</Badge>;
}
