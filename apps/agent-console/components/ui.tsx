// Presentational primitives shared across pages. Server-component friendly
// (no client hooks) so they can render inside server components.

import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-desc">{description}</p> : null}
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </div>
  );
}

export function Card({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <section className="card">
      {title ? <h2 className="card-title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

const STATUS_TONES: Record<string, string> = {
  succeeded: "good",
  active: "good",
  paid: "good",
  granted: "good",
  published: "good",
  approved: "good",
  enabled: "good",
  assigned: "good",
  pending: "warn",
  trialing: "warn",
  in_transit: "warn",
  retrying: "warn",
  past_due: "warn",
  funded: "warn",
  submitted: "warn",
  evaluated: "warn",
  settled: "good",
  open: "warn",
  created: "neutral",
  draft: "neutral",
  failed: "bad",
  canceled: "bad",
  revoked: "bad",
  refunded: "bad",
  expired: "bad",
  disabled: "bad",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? "neutral";
  const label = status.replace(/_/g, " ");
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">∅</div>
      <div className="empty-title">{title}</div>
      <p className="empty-message">{message}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <strong>API unavailable.</strong> {error}. Showing empty state — start the
      API at <code>NEXT_PUBLIC_API_URL</code> to load live data.
    </div>
  );
}

export function DataTable<T>({
  columns,
  rows,
  getKey,
  empty,
}: {
  columns: { header: string; cell: (row: T) => ReactNode; align?: "right" }[];
  rows: T[];
  getKey: (row: T) => string;
  empty: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={c.align === "right" ? "ta-right" : ""}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getKey(row)}>
              {columns.map((c) => (
                <td
                  key={c.header}
                  className={c.align === "right" ? "ta-right" : ""}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SubNav({
  items,
}: {
  items: { label: string; href: string }[];
}) {
  return (
    <div className="subnav">
      {items.map((i) => (
        <a key={i.href} href={i.href} className="subnav-link">
          {i.label}
        </a>
      ))}
    </div>
  );
}
