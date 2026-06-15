/**
 * Display formatting helpers for the checkout UI. Pure functions, no I/O.
 */
import type { Money, PaymentNetwork } from "@settlekit/common";

/** Format a Money value as "25.50 USDC" with grouped thousands. */
export function formatMoney(value: Money): string {
  return `${formatAmount(value.amount)} ${value.currency}`;
}

/** Format a bare decimal amount string with thousands separators. */
export function formatAmount(amount: string): string {
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [wholeRaw, frac] = unsigned.split(".");
  const whole = (wholeRaw ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${body}` : body;
}

/** Human label for a payment network. */
export function formatNetwork(network: PaymentNetwork): string {
  switch (network) {
    case "arc":
      return "Arc";
    case "base":
      return "Base";
    case "ethereum":
      return "Ethereum";
    default:
      return network;
  }
}

/** Block explorer base for a network + tx hash. */
export function explorerTxUrl(
  network: PaymentNetwork,
  txHash: string,
): string {
  switch (network) {
    case "base":
      return `https://basescan.org/tx/${txHash}`;
    case "ethereum":
      return `https://etherscan.io/tx/${txHash}`;
    case "arc":
      return `https://explorer.arc.network/tx/${txHash}`;
    default:
      return "#";
  }
}

/** Short-form an address or hash: 0x1234…cdef. */
export function truncateMiddle(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Format an ISO timestamp for display, e.g. "Jan 1, 2026, 14:05 UTC". */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

/** Human "in 6 days" / "expired" relative label for an expiry timestamp. */
export function formatExpiry(iso: string, now: Date = new Date()): string {
  const expires = new Date(iso).getTime();
  const diffMs = expires - now.getTime();
  if (diffMs <= 0) return "Expired";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `Expires in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Expires in ${hours} hr`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

/** True when amount a is strictly greater than zero. */
export function isPositive(value: Money): boolean {
  return Number(value.amount) > 0;
}
