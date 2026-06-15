import type { Money } from "@settlekit/common";

/** Format a Money value for display, e.g. "$1,234.50 USDC". */
export function formatMoney(value: Money): string {
  const negative = value.amount.startsWith("-");
  const unsigned = negative ? value.amount.slice(1) : value.amount;
  const [whole = "0", frac] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (frac ?? "").padEnd(2, "0").slice(0, 2);
  return `${negative ? "-" : ""}$${grouped}.${cents} ${value.currency}`;
}

/** Format an ISO timestamp as "YYYY-MM-DD HH:mm UTC". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/** Relative-time string like "3h ago" or "in 5m", anchored to now. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const deltaSec = Math.round((then - now) / 1000);
  const abs = Math.abs(deltaSec);
  const units: Array<[number, string]> = [
    [60, "s"],
    [3600, "m"],
    [86400, "h"],
    [Number.POSITIVE_INFINITY, "d"],
  ];
  let value = abs;
  let suffix = "s";
  if (abs < 60) {
    value = abs;
    suffix = "s";
  } else if (abs < 3600) {
    value = Math.round(abs / 60);
    suffix = "m";
  } else if (abs < 86400) {
    value = Math.round(abs / 3600);
    suffix = "h";
  } else {
    value = Math.round(abs / 86400);
    suffix = "d";
  }
  void units;
  return deltaSec < 0 ? `${value}${suffix} ago` : `in ${value}${suffix}`;
}

/** Title-case a snake_case or dotted identifier for display. */
export function humanize(value: string): string {
  return value
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Risk decision band → CSS class suffix used by globals.css badges. */
export function riskTone(decision: "allow" | "review" | "block"): string {
  return decision === "block" ? "danger" : decision === "review" ? "warn" : "ok";
}

/** Generic status → badge tone. */
export function statusTone(status: string): "ok" | "warn" | "danger" | "muted" {
  switch (status) {
    case "active":
    case "confirmed":
    case "succeeded":
    case "allowed":
      return "ok";
    case "pending":
    case "running":
    case "reviewing":
    case "expired":
      return "warn";
    case "failed":
    case "blocked":
    case "revoked":
    case "refunded":
    case "suspended":
    case "closed":
      return "danger";
    default:
      return "muted";
  }
}
