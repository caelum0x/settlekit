import { Notice, OutcomeBadge, PageHeader } from "@/components/ui";
import { describeError } from "@/lib/api-client";
import { describeAction } from "@/lib/decisions";
import { formatDateTime } from "@/lib/format";
import { operatorApi } from "@/lib/server-api";
import type { EscalationView } from "@/lib/types";
import { approveEscalation, rejectEscalation } from "./actions";

interface Props {
  readonly searchParams: { readonly done?: string; readonly outcome?: string; readonly error?: string };
}

function PendingCard({ e }: { readonly e: EscalationView }) {
  const rationale = typeof e.proposal.rationale === "string" ? e.proposal.rationale : "";
  return (
    <article className="card" aria-labelledby={`esc-${e.id}`}>
      <h2 id={`esc-${e.id}`}>{describeAction(e.proposal.action)}</h2>
      <dl className="kv">
        <dt>Why escalated</dt><dd>{e.reasons.join(", ") || "not stated"}</dd>
        <dt>Held</dt><dd>{e.vaultEscalationId !== undefined ? `in the vault (Pending #${e.vaultEscalationId})` : "off-chain queue"}</dd>
        <dt>Opened</dt><dd>{formatDateTime(e.createdAt)}</dd>
        <dt>Expires</dt><dd>{formatDateTime(e.expiresAt)} (auto-rejected after 72h)</dd>
        <dt>Decision</dt><dd><a href={`/decisions/${encodeURIComponent(e.decisionId)}`}>view decision</a></dd>
      </dl>
      {rationale ? <p style={{ whiteSpace: "pre-wrap" }}>{rationale}</p> : null}
      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <form action={approveEscalation}>
          <input type="hidden" name="id" value={e.id} />
          <button type="submit">Approve and execute</button>
        </form>
        <form action={rejectEscalation} className="form">
          <input type="hidden" name="id" value={e.id} />
          <label>
            Reason for rejecting
            <input name="reason" required maxLength={1000} />
          </label>
          <button type="submit" className="button-danger">Reject</button>
        </form>
      </div>
    </article>
  );
}

export default async function EscalationsPage({ searchParams }: Props) {
  let pending: readonly EscalationView[] = [];
  let resolved: readonly EscalationView[] = [];
  let loadError: string | null = null;
  try {
    const api = operatorApi();
    const all = await api.escalations();
    pending = all.filter((e) => e.status === "pending");
    resolved = all.filter((e) => e.status !== "pending").slice(-50).reverse();
  } catch (error) {
    loadError = describeError(error);
  }
  return (
    <div className="stack">
      <PageHeader
        title="Escalations"
        lead="Spends above the escalation threshold, to unknown payees, or flagged by screening wait here for you. Approving executes through the vault; nothing moves without it."
      />
      {searchParams.done ? <Notice tone="ok">Escalation {searchParams.done}. Resulting decision: {searchParams.outcome ?? "recorded"}.</Notice> : null}
      {searchParams.error ? <Notice tone="bad">{searchParams.error}</Notice> : null}
      {loadError ? <Notice tone="bad" title="Could not load escalations.">{loadError}</Notice> : null}
      <section aria-labelledby="pending-h" className="stack">
        <h2 id="pending-h">Pending ({pending.length})</h2>
        {pending.length === 0 && !loadError ? <p className="muted">Nothing is waiting for you.</p> : null}
        {pending.map((e) => <PendingCard key={e.id} e={e} />)}
      </section>
      {resolved.length > 0 ? (
        <section className="card table-wrap" aria-labelledby="resolved-h">
          <h2 id="resolved-h">Recently resolved</h2>
          <table>
            <thead><tr><th scope="col">Action</th><th scope="col">Status</th><th scope="col">Resolved</th><th scope="col">Note</th></tr></thead>
            <tbody>
              {resolved.map((e) => (
                <tr key={e.id}>
                  <td>{describeAction(e.proposal.action)}</td>
                  <td><OutcomeBadge outcome={e.status} /></td>
                  <td>{e.resolvedAt ? formatDateTime(e.resolvedAt) : ""}</td>
                  <td className="small">{e.resolution ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
