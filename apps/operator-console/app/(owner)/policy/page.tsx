import { Badge, Notice, PageHeader } from "@/components/ui";
import { describeError } from "@/lib/api-client";
import { addressUrl, executorLabel } from "@/lib/format";
import { hasDrift, policyRows, type RowStatus } from "@/lib/policy-view";
import { consoleConfig, operatorApi } from "@/lib/server-api";
import type { OperatorStateView, PolicyResponse } from "@/lib/types";

const STATUS: Readonly<Record<RowStatus, { tone: "ok" | "bad" | "neutral" | "info"; label: string }>> = {
  match: { tone: "ok", label: "In sync" },
  drift: { tone: "bad", label: "Drift" },
  off_chain_only: { tone: "info", label: "Off-chain only" },
  unknown: { tone: "neutral", label: "Unknown" },
};

export default async function PolicyPage() {
  const config = consoleConfig();
  const api = operatorApi(config);
  let res: PolicyResponse;
  try {
    res = await api.policy();
  } catch (error) {
    return (
      <>
        <PageHeader title="Policy" />
        <Notice tone="bad" title="Could not load policy.">{describeError(error)}</Notice>
      </>
    );
  }
  const state: OperatorStateView | null = await api.state().catch(() => null);
  const rows = policyRows(res, state);
  const drift = hasDrift(res, rows);
  return (
    <div className="stack">
      <PageHeader
        title="Policy"
        lead="Three layers guard every spend: the off-chain policy the agent evaluates first, the OperatorVault on Arc that enforces caps and the allowlist regardless of what the agent says, and you, for anything escalated. The off-chain policy may be stricter than the vault, never looser."
      />
      {drift ? (
        <Notice tone="bad" title="Drift detected.">
          The off-chain policy promises something the vault will not enforce. Policy updates are refused until the vault is changed by the owner.
          {res.drift.length > 0 ? <ul>{res.drift.map((d) => <li key={d}>{d}</li>)}</ul> : null}
        </Notice>
      ) : (
        <Notice tone="ok">Off-chain policy and on-chain vault agree.</Notice>
      )}
      <section className="card table-wrap" aria-labelledby="rules-h">
        <h2 id="rules-h">Rules</h2>
        <table>
          <thead>
            <tr><th scope="col">Rule</th><th scope="col">Off-chain policy</th><th scope="col">On-chain vault</th><th scope="col">Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className={r.label.startsWith("Allowlisted") ? "mono small" : undefined}>{r.label}</td>
                <td>{r.offChain}</td>
                <td>{r.onChain}</td>
                <td><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <dl className="kv">
          <dt>Engine</dt><dd>{res.engine}</dd>
          <dt>Executor</dt><dd>{executorLabel(res.executor)}</dd>
          <dt>Vault</dt>
          <dd>{res.vault ? <a className="mono" href={addressUrl(config.explorerUrl, res.vault)} target="_blank" rel="noreferrer noopener">{res.vault}</a> : "not configured (simulation)"}</dd>
        </dl>
      </section>
    </div>
  );
}
