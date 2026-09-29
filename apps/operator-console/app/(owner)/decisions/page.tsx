import { Notice, OutcomeBadge, PageHeader, TxLink } from "@/components/ui";
import { describeError } from "@/lib/api-client";
import { decisionTxHashes, latestDecisions } from "@/lib/decisions";
import { formatDateTime, formatDuration, formatUsd } from "@/lib/format";
import { consoleConfig, operatorApi } from "@/lib/server-api";
import type { DecisionView } from "@/lib/types";

const SHOWN = 100;

export default async function DecisionsPage() {
  const config = consoleConfig();
  let decisions: readonly DecisionView[];
  try {
    decisions = await latestDecisions(operatorApi(config), SHOWN);
  } catch (error) {
    return (
      <>
        <PageHeader title="Decisions" />
        <Notice tone="bad" title="Could not load decisions.">{describeError(error)}</Notice>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Decisions"
        lead={`The hash-chained decision log, newest first (latest ${SHOWN}). Each record commits to the agent's reasoning before any money moves; the commitment is anchored on Arc.`}
      />
      {decisions.length === 0 ? (
        <p className="muted">No decisions yet. They appear when a payment lands, a bill comes due, or the daily tick runs.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <caption className="sr-only">Operator decisions</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">When</th>
                <th scope="col">Event</th>
                <th scope="col">Outcome</th>
                <th scope="col">Model</th>
                <th scope="col" className="num">Latency</th>
                <th scope="col" className="num">Cost</th>
                <th scope="col">Tx</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => {
                const [tx] = decisionTxHashes(d);
                return (
                  <tr key={d.id}>
                    <td><a href={`/decisions/${encodeURIComponent(d.id)}`}>{d.seq}</a></td>
                    <td>{formatDateTime(d.createdAt)}</td>
                    <td className="mono small">{d.eventRef}</td>
                    <td><OutcomeBadge outcome={d.outcome} /></td>
                    <td className="small">{d.model}</td>
                    <td className="num">{typeof d.latencyMs === "number" ? formatDuration(d.latencyMs) : "n/a"}</td>
                    <td className="num">{d.usage ? formatUsd(d.usage.costUsd) : "n/a"}</td>
                    <td>{tx ? <TxLink explorerUrl={config.explorerUrl} hash={tx} /> : <span className="muted">none</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
