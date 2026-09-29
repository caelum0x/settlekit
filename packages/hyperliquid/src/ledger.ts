/**
 * USDC credits in a HyperCore account's non-funding ledger
 * (`info.userNonFundingLedgerUpdates`). Three delta shapes move USDC between
 * users, all recorded live on 2026-09-29 (see test/fixtures):
 *
 *   internalTransfer  a wallet's `usdSend`      { usdc, user, destination, fee }
 *   send              Relay fills / sendAsset   { token, amount, user, destination, sourceDex, destinationDex, nonce }
 *   spotTransfer      `spotSend` of USDC        { token, amount, user, destination }
 *
 * `user` is the sender. Amounts are decimal USD strings.
 */

export interface LedgerUpdate {
  time: number;
  hash: string;
  delta: { type: string } & Record<string, unknown>;
}

export interface UsdcCredit {
  hash: string;
  time: number;
  kind: "internalTransfer" | "send" | "spotTransfer";
  from: string;
  to: string;
  /** Decimal USD amount credited to `to`. */
  amount: string;
  /** Action nonce, when the ledger exposes it (`send`). */
  nonce?: number;
}

/** Perps ("") and spot balances hold USDC; builder-deployed dexes do not count. */
const USDC_DEXES: ReadonlySet<string> = new Set(["", "spot"]);

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** The USDC transfer a ledger update represents, or null (not a USDC transfer). */
export function usdcTransferOf(update: LedgerUpdate): UsdcCredit | null {
  const { delta } = update;
  const from = str(delta.user)?.toLowerCase();
  const to = str(delta.destination)?.toLowerCase();
  if (from === undefined || to === undefined || typeof update.hash !== "string") return null;
  const base = { hash: update.hash.toLowerCase(), time: update.time, from, to };
  switch (delta.type) {
    case "internalTransfer": {
      const amount = str(delta.usdc);
      return amount === undefined ? null : { ...base, kind: "internalTransfer", amount };
    }
    case "send": {
      const amount = str(delta.amount);
      if (amount === undefined || delta.token !== "USDC") return null;
      if (!USDC_DEXES.has(str(delta.destinationDex) ?? "")) return null;
      const nonce = typeof delta.nonce === "number" ? { nonce: delta.nonce } : {};
      return { ...base, kind: "send", amount, ...nonce };
    }
    case "spotTransfer": {
      const amount = str(delta.amount);
      return amount === undefined || delta.token !== "USDC" ? null : { ...base, kind: "spotTransfer", amount };
    }
    default:
      return null;
  }
}

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/**
 * Decimal USD string → 6-decimal base units, rounding DOWN (a credit is never
 * over-counted). Returns null for malformed values.
 */
export function usdToBaseUnits(amount: string): bigint | null {
  const match = DECIMAL_RE.exec(amount.trim());
  if (match === null) return null;
  const whole = match[1] as string;
  const frac = (match[2] ?? "").slice(0, 6).padEnd(6, "0");
  return BigInt(whole) * 1_000_000n + BigInt(frac);
}
