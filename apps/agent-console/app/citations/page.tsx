import { Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { ReuseDetector } from "@/components/ReuseDetector";
import { getAgentConsoleContext, type RoyaltyLegRow } from "@/lib/data";
import { formatUsdc, shortWallet } from "@/lib/format";

export default function CitationsPage() {
  const { citations } = getAgentConsoleContext();
  const { proof } = citations;

  return (
    <>
      <PageHeader
        title="Citations & proofs"
        description="When an agent is grounded in a gated source, the citation toll fans the payment out recursively through the lineage — then the agent receives a signed proof-of-citation it can present downstream."
      />

      <Card title="Try it — detect grounding in the corpus">
        <ReuseDetector />
      </Card>

      <Card title={`Recursive royalty split — "${citations.sourceTitle}"`}>
        <p className="muted" style={{ marginTop: 0 }}>
          One paid access fans out across the citation lineage: the accessed work&apos;s author (depth 0)
          keeps its share, and a recursive cut routes to every source it cites.
        </p>
        <div className="detail-grid" style={{ marginBottom: 16 }}>
          <dt>Gross toll</dt>
          <dd className="mono">{formatUsdc(citations.gross.amount)}</dd>
          <dt>Platform fee</dt>
          <dd className="mono">{formatUsdc(citations.platformFee.amount)}</dd>
          <dt>Distributable</dt>
          <dd className="mono">{formatUsdc(citations.distributable.amount)}</dd>
        </div>
        <DataTable<RoyaltyLegRow>
          rows={citations.legs}
          getKey={(r) => `${r.sourceId}-${r.depth}`}
          columns={[
            {
              header: "Tier",
              cell: (r) => (
                <span className="badge badge-neutral">
                  {r.depth === 0 ? "Author" : `Citation · L${r.depth}`}
                </span>
              ),
            },
            { header: "Source", cell: (r) => r.sourceTitle },
            { header: "Wallet", cell: (r) => <span className="mono">{shortWallet(r.wallet)}</span> },
            {
              header: "Amount",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ color: "var(--good)", fontWeight: 600 }}>
                  +{formatUsdc(r.amount.amount)}
                </span>
              ),
            },
          ]}
          empty={<EmptyState title="No legs" message="This source has no royalty distribution." />}
        />
      </Card>

      <Card title="Worked example — reuse detection">
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
          {citations.answer}
        </blockquote>

        <div className="detail-grid">
          <dt>Grounded</dt>
          <dd>
            <span className={`badge ${citations.grounded ? "badge-good" : "badge-neutral"}`}>
              {citations.grounded ? "yes" : "no"}
            </span>
          </dd>
          <dt>Grounded in</dt>
          <dd>
            {citations.matches.length > 0
              ? citations.matches.map((m) => (
                  <span key={m.sourceId} className="badge badge-good" style={{ marginRight: 6 }}>
                    {m.title} · {(m.score * 100).toFixed(0)}%
                  </span>
                ))
              : "—"}
          </dd>
          <dt>Toll owed</dt>
          <dd className="mono">{formatUsdc(citations.tollOwedUsdc)}</dd>
        </div>
      </Card>

      <Card title="Proof-of-citation">
        <p className="muted" style={{ marginTop: 0 }}>
          After settling, the agent receives a signed, expiring, replay-protected token it presents
          downstream. Anyone holding the secret can verify it without re-querying the chain.
        </p>
        <div className="detail-grid">
          <dt>Agent</dt>
          <dd className="mono">{proof.agent}</dd>
          <dt>Access</dt>
          <dd className="mono">{proof.accessId}</dd>
          <dt>Sources</dt>
          <dd className="mono">{proof.sourceIds.length > 0 ? proof.sourceIds.join(", ") : "—"}</dd>
          <dt>Amount</dt>
          <dd className="mono">{proof.amountUsdc ? formatUsdc(proof.amountUsdc) : "—"}</dd>
          <dt>Issued</dt>
          <dd className="mono">{proof.issuedAt}</dd>
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
