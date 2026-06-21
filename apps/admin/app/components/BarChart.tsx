import type { BarDatum } from "@/lib/analytics";

/**
 * A dependency-free bar chart rendered with CSS divs (no chart library, no
 * client JS). Heights are computed as a percentage of the largest value, with
 * a guard against divide-by-zero so an all-zero series renders flat tracks
 * rather than NaN heights. Colors come from the greenbar console CSS vars.
 */

type BarTone = "accent" | "ok" | "warn" | "danger" | "muted";

const TONE_VAR: Record<BarTone, string> = {
  accent: "var(--accent)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  muted: "var(--muted)",
};

interface BarChartProps {
  readonly data: readonly BarDatum[];
  /** Optional per-bar tone; falls back to `tone` then "accent". */
  readonly tones?: readonly BarTone[];
  readonly tone?: BarTone;
  /** Label shown when there is no data to plot. */
  readonly emptyText?: string;
}

export function BarChart({
  data,
  tones,
  tone = "accent",
  emptyText = "No data for this period.",
}: BarChartProps) {
  if (data.length === 0) {
    return <div className="empty">{emptyText}</div>;
  }

  const max = data.reduce((m, d) => (d.value > m ? d.value : m), 0);

  return (
    <div className="bars" role="img" aria-label="Bar chart">
      {data.map((d, i) => {
        const heightPct = max > 0 ? Math.round((d.value / max) * 100) : 0;
        const color = TONE_VAR[tones?.[i] ?? tone];
        return (
          <div className="bar-col" key={`${d.label}-${i}`} title={`${d.label}: ${d.value}`}>
            <div className="bar-value">{d.value}</div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ height: `${heightPct}%`, background: color }}
              />
            </div>
            <div className="bar-label">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}
