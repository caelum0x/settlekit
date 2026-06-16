"use client";

/**
 * The premium "AI Export" feature itself — only rendered once SettleKit confirms
 * the current customer is entitled to `ai_export`.
 *
 * To keep the example self-contained (no external AI vendor key required), the
 * "AI" step is a real, deterministic text-summarisation transform: it tokenises
 * the input, ranks sentences by keyword frequency, and emits a structured export
 * with a headline, key points and stats. It is genuine logic, not a stub.
 */
import { useMemo, useState } from "react";

interface ExportResult {
  headline: string;
  keyPoints: string[];
  stats: { sentences: number; words: number; readingSeconds: number };
}

const SAMPLE_INPUT = `Q3 revenue grew 18% to $4.2M, driven by enterprise expansion.
Net retention reached 121% as existing accounts upgraded seats.
Churn fell to 1.4% monthly after the onboarding revamp shipped in July.
The new analytics dashboard drove a 9 point lift in weekly active usage.
We closed 14 new logos, including two Fortune 500 accounts.`;

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "as",
  "at", "by", "is", "was", "were", "are", "be", "with", "that", "this", "it",
  "we", "our", "from", "after", "into", "two",
]);

function summarise(text: string): ExportResult {
  const clean = text.trim();
  const sentences = clean
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const words = clean.split(/\s+/).filter(Boolean);

  const frequency = new Map<string, number>();
  for (const raw of words) {
    const token = raw.toLowerCase().replace(/[^a-z0-9%$.]/g, "");
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  const scored = sentences
    .map((sentence, index) => {
      const score = sentence
        .toLowerCase()
        .split(/\s+/)
        .reduce((sum, raw) => {
          const token = raw.replace(/[^a-z0-9%$.]/g, "");
          return sum + (frequency.get(token) ?? 0);
        }, 0);
      return { sentence, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const keyPoints = scored.slice(0, 3).map((s) => s.sentence);
  const headline = scored[0]?.sentence ?? "Export summary";

  return {
    headline,
    keyPoints,
    stats: {
      sentences: sentences.length,
      words: words.length,
      readingSeconds: Math.max(1, Math.round((words.length / 200) * 60)),
    },
  };
}

export function ExportButton() {
  const [input, setInput] = useState(SAMPLE_INPUT);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [running, setRunning] = useState(false);

  const canExport = useMemo(() => input.trim().length > 0, [input]);

  function runExport() {
    if (!canExport) return;
    setRunning(true);
    // Simulate the latency of an async AI export pipeline, then run real logic.
    const captured = input;
    window.setTimeout(() => {
      setResult(summarise(captured));
      setRunning(false);
    }, 350);
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>AI Export</h3>
        <span className="status">
          <span className="dot dot--good" />
          Unlocked
        </span>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="exportInput">Paste your raw notes or report</label>
        <textarea
          id="exportInput"
          className="input"
          rows={6}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={runExport}
          disabled={!canExport || running}
        >
          {running ? (
            <>
              <span className="spinner" /> Exporting…
            </>
          ) : (
            "Export with AI"
          )}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          Runs locally — this is the gated premium action.
        </span>
      </div>

      {result ? (
        <div className="callout callout--good export-output">
          <strong>{result.headline}</strong>
          <ul className="features" style={{ marginTop: 10 }}>
            {result.keyPoints.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            {result.stats.sentences} sentences · {result.stats.words} words · ~
            {result.stats.readingSeconds}s read
          </p>
        </div>
      ) : null}
    </div>
  );
}
