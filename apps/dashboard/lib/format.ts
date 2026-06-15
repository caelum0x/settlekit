// Formatting helpers for money and dates used across the dashboard.

import type { Money } from "./types";

const USDC_DECIMALS = 6;
const FIAT_DECIMALS = 2;

function decimalsFor(currency: string): number {
  return currency.toUpperCase() === "USDC" ? USDC_DECIMALS : FIAT_DECIMALS;
}

/**
 * Format a Money value (minor units) into a human-readable string.
 * USDC uses 6 decimals; fiat currencies use 2.
 */
export function formatMoney(money: Money | null | undefined): string {
  if (!money) return "—";
  const decimals = decimalsFor(money.currency);
  const major = money.amount / Math.pow(10, decimals);
  const symbol = money.currency.toUpperCase();
  const formatted = major.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return symbol === "USDC" ? `${formatted} USDC` : `${symbol} ${formatted}`;
}

/** Compact money for cards/charts (e.g. "1.2K USDC"). */
export function formatMoneyCompact(money: Money | null | undefined): string {
  if (!money) return "—";
  const decimals = decimalsFor(money.currency);
  const major = money.amount / Math.pow(10, decimals);
  const compact = Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(major);
  return `${compact} ${money.currency.toUpperCase()}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

/** Render an ISO timestamp as a short readable date. */
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

/** Render an ISO timestamp with time. */
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

/** Relative "time until" for expiry display, e.g. "in 5 days". */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  if (Math.abs(diffDays) < 1) {
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    return rtf.format(diffHours, "hour");
  }
  return rtf.format(diffDays, "day");
}

/** Human file size. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Title-case a snake_case enum value for display. */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
