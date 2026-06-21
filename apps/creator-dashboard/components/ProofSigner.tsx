"use client";

import { useState } from "react";
import { formatUsdc } from "@/lib/format";

// These mirror the JSON returned by POST /api/prove (data.ts's
// SerializableProof / ProofVerification / ReuseMatch shapes). They are
// re-declared here so the client bundle never imports @/lib/data, which
// transitively pulls node crypto + the in-memory registry.
interface Match {
  sourceId: string;
  title: string;
  score: number;
  matched: number;
  total: number;
  wallet?: string;
}

interface SerializableProof {
  agent: string;
  accessId: string;
  sourceIds: string[];
  amountUsdc?: string;
  issuedAt: string;
  expiresAt?: string;
  signature: string;
}

interface ProofVerification {
  valid: boolean;
  claimAgent?: string;
  expiresAt?: string;
  error?: string;
}

interface ProveResult {
  grounded: boolean;
  matches: Match[];
  quoteUsdc: string;
  proof: SerializableProof;
  verification: ProofVerification;
}

const SAMPLE =
  "Royalties should follow a work through every hand that made it, and when settlement is sub-cent and gas-free a citation can pay its source automatically.";

export function ProofSigner() {
  const [text, setText] = useState(SAMPLE);
  const [result, setResult] = useState<ProveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json()) as { data?: ProveResult; error?: string };
      if (!res.ok || json.data === undefined) {
        setError(json.error ?? "proof failed");
        setResult(null);
      } else {
        setResult(json.data);
      }
    } catch {
      setError("network error");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="form">
      <div className="field">
        <label htmlFor="prove-answer">Agent answer</label>
        <textarea
          id="prove-answer"
          className="textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the text an agent produced…"
        />
        <span className="field-hint">
          We detect grounding, then issue a real HMAC-signed proof-of-citation and verify it server-side. The
          signing secret never leaves the server — only the proof&apos;s public fields and the verification outcome
          come back.
        </span>
      </div>
      <div className="builder-actions">
        <button className="btn btn-primary" onClick={run} disabled={loading || text.trim().length === 0}>
          {loading ? "Signing…" : "Prove & sign"}
        </button>
      </div>

      {error ? <div className="form-message err">{error}</div> : null}

      {result ? (
        <div style={{ marginTop: 8 }}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span className={`badge ${result.grounded ? "badge-good" : "badge-neutral"}`}>
              {result.grounded ? "Grounded in your sources" : "No grounding detected"}
            </span>
            <span className="mono" style={{ fontWeight: 600 }}>
              Toll owed: {formatUsdc(result.quoteUsdc)}
            </span>
          </div>

          {result.matches.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="ta-right">Containment</th>
                    <th className="ta-right">Shingles</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.map((m) => (
                    <tr key={m.sourceId}>
                      <td>{m.title}</td>
                      <td className="ta-right mono">{(m.score * 100).toFixed(0)}%</td>
                      <td className="ta-right mono">
                        {m.matched}/{m.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="detail-grid" style={{ marginTop: 14 }}>
            <dt>Agent</dt>
            <dd className="mono">{result.proof.agent}</dd>
            <dt>Access</dt>
            <dd className="mono">{result.proof.accessId}</dd>
            <dt>Sources</dt>
            <dd className="mono">
              {result.proof.sourceIds.length > 0 ? result.proof.sourceIds.join(", ") : "—"}
            </dd>
            <dt>Amount</dt>
            <dd className="mono">{formatUsdc(result.proof.amountUsdc)}</dd>
            <dt>Issued</dt>
            <dd className="mono">{result.proof.issuedAt}</dd>
            <dt>Expires</dt>
            <dd className="mono">{result.proof.expiresAt ?? "never"}</dd>
            <dt>Signature</dt>
            <dd className="mono" style={{ wordBreak: "break-all", color: "var(--text-muted)" }}>
              {result.proof.signature}
            </dd>
          </div>

          <div className="row-between" style={{ marginTop: 12 }}>
            <span className="muted">Verification</span>
            {result.verification.valid ? (
              <span className="badge badge-good">
                Valid signature{result.verification.claimAgent ? ` · ${result.verification.claimAgent}` : ""}
              </span>
            ) : (
              <span className="badge badge-bad">
                Invalid · {result.verification.error ?? "verification failed"}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
