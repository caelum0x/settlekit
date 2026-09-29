import { Badge, Meter, Notice, PageHeader, Stat } from "@/components/ui";
import { describeError } from "@/lib/api-client";
import { addressUrl, executorLabel, formatDateTime, formatPercent, formatUsdc } from "@/lib/format";
import { consoleConfig, operatorApi } from "@/lib/server-api";
import { BUCKETS, type OperatorStateView } from "@/lib/types";

const BUCKET_HELP: Readonly<Record<string, string>> = {
  OPERATING: "Float the agent pays vendors and contractors from",
  TAX: "Reserved for tax; never spendable by the agent",
  YIELD: "Sleeve for USYC yield via the vault adapter",
  REFUND: "Reserve for customer refunds",
};

export default async function OverviewPage() {
  const config = consoleConfig();
  let state: OperatorStateView;
  try {
    state = await operatorApi(config).state();
  } catch (error) {
    return (
      <>
        <PageHeader title="Overview" />
        <Notice tone="bad" title="Could not load vault state.">{describeError(error)}</Notice>
      </>
    );
  }
  const usd = (v: string) => `${formatUsdc(v)} USDC`;
  return (
    <div className="stack">
      <PageHeader
        title="Overview"
        lead={<>Balances are read from the OperatorVault through the API. Figures as of {formatDateTime(state.asOf)}.</>}
      />
      {state.executor === "local-simulation" ? (
        <Notice tone="warn" title="Simulation.">No OperatorVault is configured on the API; balances below come from the local simulator, not Arc.</Notice>
      ) : null}
      {state.paused ? <Notice tone="bad" title="Vault paused.">The owner kill switch is on; the agent cannot move funds.</Notice> : null}

      <section aria-labelledby="buckets-h">
        <h2 id="buckets-h">Vault buckets</h2>
        <div className="grid grid-4">
          {BUCKETS.map((b) => (
            <Stat key={b} label={b.charAt(0) + b.slice(1).toLowerCase()} value={usd(state.buckets[b])} hint={BUCKET_HELP[b]} />
          ))}
        </div>
      </section>

      <div className="grid grid-4">
        <Stat label="Held by the vault" value={usd(state.total)} />
        <Stat label="Unallocated inflow" value={usd(state.unallocated)} hint="Awaiting the agent's allocation" />
        <Stat label="Reserved for escalations" value={usd(state.pendingReserved)} />
        <Stat label="Deployed to yield" value={usd(state.yieldDeployed)} hint={state.yieldEnabled ? "USYC adapter set" : "No yield adapter set"} />
      </div>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="spend-h">
          <h2 id="spend-h">Today's spend vs caps</h2>
          <p className="stat-value">{usd(state.spentToday)} <span className="muted small">of {usd(state.caps.dailyCap)} daily cap</span></p>
          <Meter value={state.dailyCapUsed} label="Daily cap used" />
          <p className="stat-hint">{formatPercent(state.dailyCapUsed)} used (UTC day, as enforced by the vault)</p>
          <dl className="kv" style={{ marginTop: 16 }}>
            <dt>Per-payment cap</dt><dd>{usd(state.caps.perTxCap)}</dd>
            <dt>Escalate above</dt><dd>{usd(state.caps.escalateAbove)}</dd>
          </dl>
        </section>
        <section className="card" aria-labelledby="esc-h">
          <h2 id="esc-h">Human in the loop</h2>
          <p className="stat-value">{state.pendingEscalations}</p>
          <p className="stat-hint">pending escalation{state.pendingEscalations === 1 ? "" : "s"}</p>
          <p><a className="button" href="/escalations">Review escalations</a></p>
          <dl className="kv">
            <dt>Executor</dt><dd>{executorLabel(state.executor)}</dd>
            <dt>Vault</dt>
            <dd>{state.vault ? <a className="mono" href={addressUrl(state.explorerUrl, state.vault)} target="_blank" rel="noreferrer noopener">{state.vault}</a> : <Badge tone="warn">not configured</Badge>}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
