/** Display formatting shared by console pages. Pure and locale-stable (en-US). */

const USDC_DECIMALS = 6;

/** "1234.5" -> "1,234.50" (decimal USDC string, never floats). */
export function formatUsdc(decimal: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) return decimal;
  const sign = match[1] ?? "";
  const whole = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // At least cents; keep sub-cent digits (USDC has 6 dp) without trailing zeros.
  const frac = (match[3] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${sign}${grouped}.${frac}`;
}

/** USDC base units (6 dp) as a decimal string -> decimal USDC string. */
export function baseUnitsToUsdc(base: string | number | bigint): string {
  const value = BigInt(base);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(USDC_DECIMALS);
  const frac = (abs % unit).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${abs / unit}${frac ? `.${frac}` : ""}`;
}

/** Milliseconds -> "850 ms" / "1.2 s" / "2 min 5 s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "n/a";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** USD with enough precision for sub-cent model costs. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatPercent(share: number): string {
  if (!Number.isFinite(share)) return "0%";
  return `${Math.round(share * 1000) / 10}%`;
}

/** 0x1234…abcd */
export function shortHash(hash: string, size = 6): string {
  if (hash.length <= size * 2 + 3) return hash;
  return `${hash.slice(0, size + 2)}…${hash.slice(-size)}`;
}

export function txUrl(explorerUrl: string, txHash: string): string {
  return `${explorerUrl.replace(/\/+$/, "")}/tx/${txHash}`;
}

export function addressUrl(explorerUrl: string, address: string): string {
  return `${explorerUrl.replace(/\/+$/, "")}/address/${address}`;
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const EXECUTORS: Readonly<Record<string, string>> = {
  "circle-dcw": "Circle Developer-Controlled Wallet",
  "viem-signer": "Local signer (viem)",
  "local-simulation": "Local simulation (no chain)",
};

export function executorLabel(kind: string): string {
  return EXECUTORS[kind] ?? kind;
}
