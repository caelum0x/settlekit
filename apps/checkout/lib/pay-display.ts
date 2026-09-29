/**
 * Pure display logic for the payment components (client-safe): picker
 * grouping, quote countdown and short labels. Kept out of the components so
 * it is unit tested.
 */
import type { NetworkOption } from "./network-options";

export interface NetworkGroup {
  id: "solana" | "evm" | "zcash";
  label: string;
  options: NetworkOption[];
}

const GROUPS: ReadonlyArray<Pick<NetworkGroup, "id" | "label">> = [
  { id: "solana", label: "Solana" },
  { id: "evm", label: "EVM chains" },
  { id: "zcash", label: "Zcash" },
];

/** Group available options for the picker: Solana, EVM chains, Zcash (empty groups dropped). */
export function groupNetworkOptions(options: readonly NetworkOption[]): NetworkGroup[] {
  return GROUPS.map((group) => ({
    ...group,
    options: options.filter((option) => option.available && option.family === group.id),
  })).filter((group) => group.options.length > 0);
}

/** Milliseconds until `expiresAt` (0 once passed or unparseable). */
export function remainingMs(expiresAt: string, now: number): number {
  const end = new Date(expiresAt).getTime();
  return Number.isNaN(end) ? 0 : Math.max(0, end - now);
}

/** "14:05" style countdown (minutes may exceed 59). */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Spoken form for screen readers, e.g. "14 minutes 5 seconds". */
export function describeCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    minutes > 0 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : "",
    seconds > 0 || minutes === 0 ? `${seconds} second${seconds === 1 ? "" : "s"}` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** "0x1234…cdef" for a tx hash in link text. */
export function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

/** Full explorer URL from a prefix, or "" when the chain has no explorer. */
export function explorerLink(prefix: string | null, hash: string): string {
  return prefix ? `${prefix}${encodeURIComponent(hash)}` : "";
}
