import type { Metadata } from "next";
import { Badge, Notice, OutcomeBadge, PageHeader, Stat } from "@/components/ui";
import { describeError } from "@/lib/api-client";
import { addressUrl, formatDateTime } from "@/lib/format";
import { formatProof, verifyRecent, type ProofView } from "@/lib/proof-format";
import { consoleConfig, operatorApi } from "@/lib/server-api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Live proof | Tameion Operator",
  description: "Live, verifiable metrics for an autonomous business operator settling USDC on Arc testnet.",
};

export default async function ProofPage() {
  const config = consoleConfig();
  const api = operatorApi(config);
  let view: ProofView;
  try {
    const proof = await api.proof();
    const verifications = await verifyRecent(proof, (id) => api.verify(id));
    view = formatProof(proof, config.explorerUrl, verifications);
  } catch (error) {
    return (
      <>
        <PageHeader title="Live proof" />
        <Notice tone="bad" title="Proof is unavailable right now.">{describeError(error)}</Notice>
      </>
    );
  }
  return (
    <div className="stack">
      <PageHeader
        title="Live proof"
        lead={
          <>
            Every number here is computed from the operator&apos;s hash-chained decision log, and every transaction links to Arcscan.
            Network: <strong>{view.networkLabel}</strong>. The demo organization is excluded. Updated {formatDateTime(view.generatedAt)}.
          </>
        }
      />
      <p><Badge tone="warn">{view.networkLabel}</Badge> {view.isSimulation ? <Badge tone="bad">simulation: no vault configured</Badge> : null}</p>
      {view.isSimulation ? (
        <Notice tone="warn">This deployment is running without an OperatorVault; decisions are real but executions are simulated and not on-chain.</Notice>
      ) : null}

      <section aria-labelledby="metrics-h">
        <h2 id="metrics-h">Metrics</h2>
        <div className="grid grid-4">
          {view.tiles.map((t) => <Stat key={t.label} label={t.label} value={t.value} {...(t.hint ? { hint: t.hint } : {})} />)}
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card table-wrap" aria-labelledby="outcomes-h">
          <h2 id="outcomes-h">Decisions by outcome</h2>
          <table>
            <thead><tr><th scope="col">Outcome</th><th scope="col" className="num">Count</th><th scope="col" className="num">Share</th></tr></thead>
            <tbody>
              {view.outcomes.map((o) => (
                <tr key={o.key}><td>{o.label}</td><td className="num">{o.count}</td><td className="num">{o.share}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Blocked-by-policy and blocked-on-chain overlap other outcomes: they count decisions where the off-chain policy or the vault itself refused a spend.</p>
        </section>
        <section className="card table-wrap" aria-labelledby="models-h">
          <h2 id="models-h">Who decided</h2>
          {view.models.length === 0 ? <p className="muted">No decisions yet.</p> : (
            <table>
              <thead><tr><th scope="col">Model</th><th scope="col" className="num">Decisions</th></tr></thead>
              <tbody>{view.models.map((m) => <tr key={m.model}><td>{m.model}</td><td className="num">{m.count}</td></tr>)}</tbody>
            </table>
          )}
          {view.vault ? (
            <p className="small">Vault: <a className="mono" href={addressUrl(config.explorerUrl, view.vault)} target="_blank" rel="noreferrer noopener">{view.vault}</a></p>
          ) : null}
        </section>
      </div>

      <section className="card table-wrap" aria-labelledby="recent-h">
        <h2 id="recent-h">Recent on-chain decisions</h2>
        {view.recent.length === 0 ? <p className="muted">No anchored decisions yet.</p> : (
          <table>
            <thead>
              <tr><th scope="col">When</th><th scope="col">Outcome</th><th scope="col">Transaction</th><th scope="col">Anchor</th><th scope="col">Hash chain</th></tr>
            </thead>
            <tbody>
              {view.recent.map((r) => (
                <tr key={`${r.decisionId}-${r.txHash}`}>
                  <td>{formatDateTime(r.createdAt)}</td>
                  <td><OutcomeBadge outcome={r.outcome} /></td>
                  <td><a className="mono" href={r.txUrl} target="_blank" rel="noreferrer noopener" title={r.txHash}>{r.txLabel}</a></td>
                  <td><Badge tone={r.anchor === "anchored" ? "ok" : r.anchor === "unverified" || r.anchor === "not_configured" ? "neutral" : "bad"}>{r.anchorLabel}</Badge></td>
                  <td>{r.chainValid === null ? <span className="muted">n/a</span> : r.chainValid ? "intact" : "broken"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="muted small">
        Anyone can re-check a decision: GET /v1/public/operator/verify/:id recomputes the hash chain and reads the DecisionAnchored event from the Arc receipt.
      </p>
    </div>
  );
}
