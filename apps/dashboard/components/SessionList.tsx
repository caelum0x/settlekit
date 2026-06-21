"use client";

import { useCallback, useEffect, useState } from "react";

interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

interface Notice {
  ok: boolean;
  text: string;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Active sessions list with per-session revoke. Reads /api/sessions (which
 * forwards the httpOnly cookie as bearer) and revokes via DELETE
 * /api/sessions/:id. The current session is labeled and not revocable here.
 */
export function SessionList() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | { data?: { sessions?: SessionRow[] }; error?: string }
        | null;
      if (!res.ok || !body?.data) {
        setNotice({ ok: false, text: body?.error ?? "Could not load sessions." });
        return;
      }
      setRows(body.data.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setPendingId(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ ok: false, text: body?.error ?? "Could not revoke session." });
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      setNotice({ ok: true, text: "Session revoked." });
    } finally {
      setPendingId(null);
    }
  }

  if (loading) return <p className="page-desc">Loading sessions…</p>;
  if (rows.length === 0) return <p className="page-desc">No active sessions.</p>;

  return (
    <div className="session-list">
      <table className="data-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Started</th>
            <th>Expires</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono">
                {r.id.slice(0, 12)}…{r.current ? <span className="badge"> this device</span> : null}
              </td>
              <td>{fmt(r.createdAt)}</td>
              <td>{fmt(r.expiresAt)}</td>
              <td className="ta-right">
                {r.current ? (
                  <span className="page-desc">current</span>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => revoke(r.id)}
                    disabled={pendingId === r.id}
                  >
                    {pendingId === r.id ? "Revoking…" : "Revoke"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {notice ? (
        <div className={`form-message ${notice.ok ? "ok" : "err"}`}>{notice.text}</div>
      ) : null}
    </div>
  );
}
