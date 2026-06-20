import { Card, PageHeader } from "@/components/ui";
import { ReuseDetector } from "@/components/ReuseDetector";
import { getCreatorContext } from "@/lib/data";
import { formatUsdc } from "@/lib/format";

export default function AttributionPage() {
  const { attribution } = getCreatorContext();
  const { proof } = attribution;

  return (
    <>
      <PageHeader
        title="Reuse & proofs"
        description="The citation toll charges deliberate fetches. Attribution closes the loop — it detects when an agent's output was grounded in your work and charges that implicit reuse (RFB 6.01)."
      />

      <Card title="Try it — detect grounding in your sources">
        <ReuseDetector />
      </Card>

      <Card title="Worked example">
        <p className="muted" style={{ marginTop: 0 }}>
          An agent produced this answer:
        </p>
        <blockquote
          style={{
            margin: "0 0 16px",
            padding: "12px 14px",
            borderLeft: "3px solid var(--accent)",
            background: "var(--bg-elevated)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {attribution.answer}
        </blockquote>

        <div className="detail-grid">
          <dt>Grounded in</dt>
          <dd>
            {attribution.matches.map((m) => (
              <span key={m.sourceId} className="badge badge-good" style={{ marginRight: 6 }}>
                {m.title} · {(m.score * 100).toFixed(0)}%
              </span>
            ))}
          </dd>
          <dt>Toll owed</dt>
          <dd className="mono">{formatUsdc(attribution.quoteUsdc)}</dd>
        </div>
      </Card>

      <Card title="Proof-of-citation">
        <p className="muted" style={{ marginTop: 0 }}>
          After settling, the agent receives a signed, expiring, replay-protected token it presents downstream.
          Anyone holding the secret can verify it without re-querying the chain.
        </p>
        <div className="detail-grid">
          <dt>Agent</dt>
          <dd className="mono">{proof.agent}</dd>
          <dt>Access</dt>
          <dd className="mono">{proof.accessId}</dd>
          <dt>Sources</dt>
          <dd className="mono">{proof.sourceIds.join(", ")}</dd>
          <dt>Amount</dt>
          <dd className="mono">{proof.amountUsdc ? formatUsdc(proof.amountUsdc) : "—"}</dd>
          <dt>Expires</dt>
          <dd className="mono">{proof.expiresAt ?? "never"}</dd>
          <dt>Signature</dt>
          <dd className="mono" style={{ wordBreak: "break-all", color: "var(--text-muted)" }}>
            {proof.signature}
          </dd>
        </div>
      </Card>
    </>
  );
}
