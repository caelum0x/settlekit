/**
 * Presentation-layer formatting helpers for SettleKit UIs.
 *
 * Monetary formatting NEVER uses floating point — it operates on the canonical
 * decimal-string + bigint base-unit representation from @settlekit/common.
 */

import { fromBaseUnits, toBaseUnits, USDC_DECIMALS } from "@settlekit/common";
import type { Currency, PaymentNetwork } from "@settlekit/common";

export interface FormatUsdcOptions {
  /** Minimum fractional digits to render. Default 2. */
  minimumFractionDigits?: number;
  /** Maximum fractional digits to render. Default 2 (USDC max 6). */
  maximumFractionDigits?: number;
  /** Append the currency code (e.g. "USDC"). Default false. */
  withCurrency?: boolean;
  /** Group the integer part with thousands separators. Default true. */
  grouping?: boolean;
}

const DEFAULT_MIN_FRACTION = 2;

/**
 * Format a USDC decimal-string amount for display.
 *
 * Works entirely on string / bigint values so there is no float rounding.
 * The amount must be a valid decimal string (validated by `toBaseUnits`).
 */
export function formatUsdc(amount: string, options: FormatUsdcOptions = {}): string {
  const {
    minimumFractionDigits = DEFAULT_MIN_FRACTION,
    maximumFractionDigits = DEFAULT_MIN_FRACTION,
    withCurrency = false,
    grouping = true,
  } = options;

  const minFraction = clampFraction(minimumFractionDigits);
  const maxFraction = Math.max(minFraction, clampFraction(maximumFractionDigits));

  // Normalize through base units so the input is validated and canonicalized.
  const normalized = fromBaseUnits(toBaseUnits(amount));
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;

  const [wholePartRaw = "0", fracPartRaw = ""] = unsigned.split(".");
  const wholePart = grouping ? groupDigits(wholePartRaw) : wholePartRaw;
  const fracPart = formatFraction(fracPartRaw, minFraction, maxFraction);

  const body = fracPart.length > 0 ? `${wholePart}.${fracPart}` : wholePart;
  const signed = negative ? `-${body}` : body;
  return withCurrency ? `${signed} USDC` : signed;
}

/** Format a Money-style currency code for display. */
export function formatCurrency(currency: Currency): string {
  return currency;
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MIN_FRACTION;
  const int = Math.trunc(value);
  if (int < 0) return 0;
  if (int > USDC_DECIMALS) return USDC_DECIMALS;
  return int;
}

function groupDigits(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatFraction(frac: string, min: number, max: number): string {
  // Pad to the maximum so we can safely trim trailing zeros down to the min.
  let padded = (frac + "0".repeat(max)).slice(0, max);
  while (padded.length > min && padded.endsWith("0")) {
    padded = padded.slice(0, -1);
  }
  return padded;
}

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

interface RelativeUnit {
  unit: Intl.RelativeTimeFormatUnit;
  ms: number;
}

const RELATIVE_UNITS: readonly RelativeUnit[] = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
  { unit: "second", ms: 1000 },
];

/** Accepts ISO-8601 strings, epoch millis, or Date. */
export type DateInput = string | number | Date;

function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input);
}

/** Format an absolute date, e.g. "Jun 14, 2026". */
export function formatDate(input: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = options ?? {
    year: "numeric",
    month: "short",
    day: "numeric",
  };
  return new Intl.DateTimeFormat("en", opts).format(date);
}

/** Format a date + time, e.g. "Jun 14, 2026, 3:04 PM". */
export function formatDateTime(input: DateInput): string {
  return formatDate(input, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Human relative time, e.g. "3 days ago", "in 2 hours". */
export function relativeTime(input: DateInput, now: DateInput = new Date()): string {
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = date.getTime() - toDate(now).getTime();
  const absMs = Math.abs(diffMs);

  for (const { unit, ms } of RELATIVE_UNITS) {
    if (absMs >= ms || unit === "second") {
      const value = Math.round(diffMs / ms);
      return RTF.format(value, unit);
    }
  }
  return RTF.format(0, "second");
}

/**
 * Turn a machine token into a human label:
 * "past_due" -> "Past Due", "apiKey" -> "Api Key", "base-mainnet" -> "Base Mainnet".
 */
export function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

interface ExplorerConfig {
  txPath: (hash: string) => string;
}

const BLOCK_EXPLORERS: Record<PaymentNetwork, ExplorerConfig> = {
  base: { txPath: (hash) => `https://basescan.org/tx/${hash}` },
  ethereum: { txPath: (hash) => `https://etherscan.io/tx/${hash}` },
  // Arc is Circle's settlement network; route to Circle's explorer.
  arc: { txPath: (hash) => `https://explorer.circle.com/tx/${hash}` },
};

/**
 * Build a block-explorer URL for a transaction hash on a given network.
 * Returns null for unknown networks or empty hashes so callers can fall back.
 */
export function blockExplorerUrl(network: PaymentNetwork, txHash: string): string | null {
  const hash = txHash.trim();
  if (hash.length === 0) return null;
  const explorer = BLOCK_EXPLORERS[network];
  if (explorer === undefined) return null;
  return explorer.txPath(hash);
}

/** Truncate a hash/address for display: "0x1234…abcd". */
export function truncateHash(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}
