// Formatting helpers. Money here is a decimal USDC string (the shape the
// settlement spine produces, e.g. "0.0008"), not minor units.

/** Format a decimal USDC string, keeping sub-cent precision when present. */
export function formatUsdc(amount: string | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const value = Number(amount);
  if (Number.isNaN(value)) return `${amount} USDC`;
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
  return `${formatted} USDC`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

/** Render an ISO timestamp as a short readable date-time. */
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

/** Title-case a snake_case enum value for display. */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Shorten a wallet address for display: 0x1234…abcd. */
export function shortWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}
