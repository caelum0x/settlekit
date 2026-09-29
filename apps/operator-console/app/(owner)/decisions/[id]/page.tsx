import { notFound } from "next/navigation";
import { Badge, Notice, OutcomeBadge, PageHeader, TxLink } from "@/components/ui";
import { ApiError, describeError } from "@/lib/api-client";
import { decisionTxHashes, traceSteps } from "@/lib/decisions";
import { baseUnitsToUsdc, formatDateTime, formatDuration, formatUsd, formatUsdc } from "@/lib/format";
import { anchorLabel, anchorStatus } from "@/lib/proof-format";
import { consoleConfig, operatorApi } from "@/lib/server-api";
import type { DecisionVerification, DecisionView } from "@/lib/types";

interface Props {
  readonly params: { readonly id: string };
  readonly searchParams: { readonly verify?: string };
}

function VerifyResult({ result, explorerUrl }: { readonly result: DecisionVerification; readonly explorerUrl: string }) {
  const status = anchorStatus(result);
  return (
    <section className="card" aria-labelledby="verify-h" aria-live="polite">
      <h2 id="verify-h">Verification on Arc</h2>
      <p>
        <Badge tone={result.valid ? "ok" : "bad"}>{result.valid ? "Verified" : "Not verified"}</Badge>{" "}
        <Badge tone={status === "anchored" ? "ok" : status === "not_configured" ? "neutral" : "warn"}>{anchorLabel(status)}</Badge>
      </p>
      <dl className="kv">
        <dt>Hash chain</dt>
        <dd>{result.chain.valid ? `intact (${result.chain.checked} records checked)` : `broken at ${result.chain.brokenAt ?? "?"}: ${result.chain.reason ?? ""}`}</dd>
        <dt>Commitment</dt>
        <dd>{result.commitment.replace(/_/g, " ")}</dd>
        <dt>Anchor hash</dt>
        <dd className="mono">{result.anchorHash ?? "none"}</dd>
      </dl>
      {Array.isArray(result.onChain) && result.onChain.length > 0 ? (
        <ul className="plain" style={{ marginTop: 12 }}>
          {result.onChain.map((c) => (
            <li key={c.txHash}>
              <TxLink explorerUrl={explorerUrl} hash={c.txHash} /> {c.status.replace(/_/g, " ")}
              {c.actions.length > 0 ? <span className="muted small"> ({c.actions.join(", ")})</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default async function DecisionPage({ params, searchParams }: Props) {
  const config = consoleConfig();
  const api = operatorApi(config);
  let decision: DecisionView;
  try {
    decision = await api.decision(params.id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <Notice tone="bad" title="Could not load decision.">{describeError(error)}</Notice>;
  }

  let verification: DecisionVerification | null = null;
  let verifyError: string | null = null;
  if (searchParams.verify === "1") {
    try {
      verification = await api.verify(decision.id);
    } catch (error) {
      verifyError = describeError(error);
    }
  }

  const txs = decisionTxHashes(decision);
  const verdict = decision.policyVerdict;
  return (
    <div className="stack">
      <p className="small"><a href="/decisions">All decisions</a></p>
      <PageHeader title={`Decision #${decision.seq}`} lead={<>Event <span className="mono">{decision.eventRef}</span> at {formatDateTime(decision.createdAt)}</>} />

      <div className="row">
        <OutcomeBadge outcome={decision.outcome} />
        <Badge tone="info">{decision.model}</Badge>
        <span className="muted small">confidence {Math.round(decision.confidence * 100)}%</span>
        {typeof decision.latencyMs === "number" ? <span className="muted small">latency {formatDuration(decision.latencyMs)}</span> : null}
        {decision.usage ? (
          <span className="muted small">
            {decision.usage.inputTokens} in / {decision.usage.outputTokens} out tokens, {formatUsd(decision.usage.costUsd)}
          </span>
        ) : null}
      </div>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="why-h">
          <h2 id="why-h">Rationale</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{decision.rationale || "No rationale recorded."}</p>
          <h2>Alternatives considered</h2>
          {decision.alternatives.length > 0 ? (
            <ul>{decision.alternatives.map((a, i) => <li key={i}>{a}</li>)}</ul>
          ) : (
            <p className="muted">None recorded.</p>
          )}
        </section>
        <section className="card" aria-labelledby="verdict-h">
          <h2 id="verdict-h">Policy verdict</h2>
          {verdict ? (
            <dl className="kv">
              <dt>Decision</dt><dd><OutcomeBadge outcome={verdict.decision === "allow" ? "executed" : verdict.decision === "escalate" ? "escalated" : "denied"} /> {verdict.decision}</dd>
              <dt>Reasons</dt><dd>{verdict.reasons.length > 0 ? verdict.reasons.join(", ") : "none"}</dd>
              {verdict.escalation ? <><dt>Held</dt><dd>{verdict.escalation === "vault" ? "in the vault (on-chain Pending)" : "off-chain queue"}</dd></> : null}
              <dt>Spent today</dt><dd>{formatUsdc(baseUnitsToUsdc(verdict.spentToday))} USDC</dd>
            </dl>
          ) : (
            <p className="muted">No spend was evaluated for this decision.</p>
          )}
          <h2 style={{ marginTop: 16 }}>Transactions</h2>
          {txs.length > 0 ? (
            <ul className="plain">{txs.map((t) => <li key={t}><TxLink explorerUrl={config.explorerUrl} hash={t} /></li>)}</ul>
          ) : (
            <p className="muted">No on-chain transaction.</p>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="chain-h">
        <h2 id="chain-h">Hash chain</h2>
        <dl className="kv">
          <dt>Hash</dt><dd className="mono">{decision.hash}</dd>
          <dt>Previous</dt><dd className="mono">{decision.prevHash}</dd>
          <dt>Anchored commitment</dt><dd className="mono">{decision.anchorHash ?? "not anchored"}</dd>
          <dt>Inputs digest</dt><dd className="mono">{decision.inputsDigest}</dd>
        </dl>
        <form method="get" style={{ marginTop: 12 }}>
          <input type="hidden" name="verify" value="1" />
          <button type="submit">Verify on Arc</button>
        </form>
        <p className="muted small">Recomputes the hash chain and checks the DecisionAnchored event in each transaction receipt on Arc testnet.</p>
      </section>

      {verifyError ? <Notice tone="bad" title="Verification failed.">{verifyError}</Notice> : null}
      {verification ? <VerifyResult result={verification} explorerUrl={config.explorerUrl} /> : null}

      <section className="card" aria-labelledby="trace-h">
        <h2 id="trace-h">Tool trace</h2>
        {decision.toolCalls.length === 0 ? <p className="muted">No tool calls.</p> : null}
        <ol className="plain">
          {traceSteps(decision.toolCalls).map((s) => (
            <li key={s.index}>
              <details>
                <summary>{s.index}. {s.name}</summary>
                <pre aria-label={`${s.name} input`}>{s.input}</pre>
                {s.output !== null ? <pre aria-label={`${s.name} output`}>{s.output}</pre> : null}
              </details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
