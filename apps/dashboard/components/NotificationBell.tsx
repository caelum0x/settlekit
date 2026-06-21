"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRelative } from "@/lib/format";

type NotificationLevel = "info" | "warn" | "error";

interface Notification {
  id: string;
  title: string;
  detail: string;
  level: NotificationLevel;
  at: string;
}

const LEVEL_TONE: Record<NotificationLevel, string> = {
  info: "good",
  warn: "warn",
  error: "bad",
};

/**
 * Header notification center: a bell button with an unread-count badge and a
 * dropdown of recent delivery activity. Fetches /api/notifications (which
 * bridges the server-only api client) on mount. Pure client component — never
 * imports lib/api.ts.
 */
export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as
        | { data?: Notification[]; error?: string }
        | null;
      if (!res.ok || !body?.data) {
        setError(body?.error ?? "Could not load notifications.");
        setItems([]);
        return;
      }
      setItems(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = items.filter((n) => n.level !== "info").length;

  return (
    <div className="bell-wrap" ref={containerRef}>
      <button
        type="button"
        className="bell"
        aria-label="Notifications"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 ? (
          <span className="bell-badge" aria-label={`${unread} unread`}>
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notif-dropdown" role="menu">
          <div className="notif-head">
            <span>Notifications</span>
            <button type="button" className="notif-refresh" onClick={() => void load()}>
              Refresh
            </button>
          </div>

          <div className="notif-body">
            {loading ? (
              <p className="notif-empty">Loading…</p>
            ) : error ? (
              <p className="notif-empty">{error}</p>
            ) : items.length === 0 ? (
              <p className="notif-empty">No recent notifications</p>
            ) : (
              items.map((n) => (
                <div className="notif-item" key={n.id}>
                  <span className={`notif-dot dot-${LEVEL_TONE[n.level]}`} aria-hidden="true" />
                  <div className="notif-content">
                    <div className="notif-title">{n.title}</div>
                    <div className="notif-detail">{n.detail}</div>
                    <div className="notif-time">{formatRelative(n.at)}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <a href="/delivery/runs" className="notif-viewall">
            View all delivery runs →
          </a>
        </div>
      ) : null}
    </div>
  );
}
