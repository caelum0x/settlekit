"use client";

import { useState } from "react";

interface Match {
  sourceId: string;
  title: string;
  score: number;
  matched: number;
  total: number;
  wallet?: string;
}

interface DetectResult {
  grounded: boolean;
  matches: Match[];
  quoteUsdc: string;
}

const SAMPLE =
  "Royalties should follow a work through every hand that made it, and when settlement is sub-cent and gas-free a citation can pay its source automatically.";

export function ReuseDetector() {
  const [text, setText] = useState(SAMPLE);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/detect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json()) as { data?: DetectResult; error?: string };
      if (!res.ok || json.data === undefined) {
        setError(json.error ?? "detection failed");
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
        <label htmlFor="answer">Agent answer</label>
        <textarea
          id="answer"
          className="textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the text an agent produced…"
        />
        <span className="field-hint">
          We shingle the text and check containment against your source corpus — the same call the citation-toll
          sidecar exposes at <code>POST /attribution/detect</code>.
        </span>
      </div>
      <div className="builder-actions">
        <button className="btn btn-primary" onClick={run} disabled={loading || text.trim().length === 0}>
          {loading ? "Detecting…" : "Detect reuse"}
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
              Toll owed: {result.quoteUsdc} USDC
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
        </div>
      ) : null}
    </div>
  );
}
