// Display formatters for the customer portal.
// USDC amounts arrive as decimal strings (major unit) — we never parse them
// into floats for math, only normalize them for display.

import type { Money } from "./types";

/** Format a Money value as e.g. "25.50 USDC". Degrades safely on bad input. */
export function formatMoney(value: Money | null | undefined): string {
  if (!value || typeof value.amount !== "string") return "—";
  const currency = value.currency ?? "USDC";
  return `${formatAmount(value.amount)} ${currency}`;
}

/** Normalize a decimal-string amount to 2+ decimals for display. */
export function formatAmount(amount: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(amount)) return amount;
  const [whole, frac = ""] = amount.split(".");
  const padded = (frac + "00").slice(0, Math.max(2, frac.length));
  return `${whole}.${padded}`;
}

/** Format an ISO timestamp as a readable date (UTC-stable, locale-light). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Format an ISO timestamp as a readable date + time. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Relative "x ago" for last-used / recency hints. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return formatDate(iso);
}

/** Humanize a snake_case enum/type into Title Case words. */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Build a block-explorer URL for a tx hash on a given network. */
export function explorerTxUrl(
  network: string | null | undefined,
  txHash: string | null | undefined,
): string | null {
  if (!txHash) return null;
  switch (network) {
    case "base":
      return `https://basescan.org/tx/${txHash}`;
    case "ethereum":
      return `https://etherscan.io/tx/${txHash}`;
    case "arc":
      // Arc settlement layer explorer.
      return `https://explorer.arc.network/tx/${txHash}`;
    default:
      return `https://basescan.org/tx/${txHash}`;
  }
}

/** Read a string-ish feature value from an entitlement features map. */
export function featureString(
  features: Record<string, boolean | number | string> | undefined,
  key: string,
): string | null {
  const v = features?.[key];
  if (v === undefined || v === null) return null;
  return String(v);
}

/** Read a numeric feature value from an entitlement features map. */
export function featureNumber(
  features: Record<string, boolean | number | string> | undefined,
  key: string,
): number | null {
  const v = features?.[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  return null;
}

/** Shorten a hash/address for compact display: 0x1234…abcd. */
export function shortHash(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
