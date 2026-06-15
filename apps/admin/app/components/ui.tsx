import type { ReactNode } from "react";
import { statusTone } from "@/lib/format";

/** A colored status pill driven by the shared statusTone mapping. */
export function Badge({ label }: { label: string }) {
  return <span className={`badge ${statusTone(label)}`}>{label}</span>;
}

/** A generic colored pill with an explicit tone. */
export function Pill({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "danger" | "muted";
}) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

/** Small metric card for the overview grid. */
export function MetricCard({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

/** Empty-state row for a table body. */
export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="empty">{text}</div>
      </td>
    </tr>
  );
}

/** Inline flag chips. */
export function Flags({ flags }: { flags: readonly string[] }) {
  if (flags.length === 0) return <span className="flag">none</span>;
  return (
    <span className="flags">
      {flags.map((f, i) => (
        <span key={`${f}-${i}`} className="flag">
          {f}
        </span>
      ))}
    </span>
  );
}
