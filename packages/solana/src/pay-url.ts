/**
 * Solana Pay URL encoding/parsing (https://docs.solanapay.com/spec).
 *
 * Transfer request:
 *   solana:<recipient>?amount=<amount>&spl-token=<mint>&reference=<r1>&reference=<r2>
 *          &label=<label>&message=<message>&memo=<memo>
 * Transaction request:
 *   solana:<link>   — an absolute https URL, URL-encoded when it carries a query.
 *
 * Implemented in-repo (not `@solana/pay`, which drags in web3.js v1).
 */

import { isSolanaAddress } from "./validate.js";

export const SOLANA_PAY_PROTOCOL = "solana:";

/** Decimal amount with no exponent; values below 1 need a leading zero. */
const AMOUNT_RE = /^\d+(\.\d+)?$/;

export interface TransferRequestFields {
  recipient: string;
  /** Decimal major-unit amount, e.g. "0.01". */
  amount?: string;
  splToken?: string;
  references?: readonly string[];
  label?: string;
  message?: string;
  memo?: string;
}

export interface TransactionRequestFields {
  /** Absolute https URL the wallet POSTs its account to. */
  link: string;
}

export type ParsedSolanaPayUrl =
  | ({ kind: "transfer" } & TransferRequestFields)
  | ({ kind: "transaction" } & TransactionRequestFields);

export class SolanaPayUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaPayUrlError";
  }
}

/** Normalize a decimal amount: strip redundant leading/trailing zeros. */
function normalizeAmount(amount: string, maxDecimals?: number): string {
  if (!AMOUNT_RE.test(amount)) {
    throw new SolanaPayUrlError(`invalid amount "${amount}": must be a non-negative decimal`);
  }
  const [wholeRaw = "0", fracRaw = ""] = amount.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  const frac = fracRaw.replace(/0+$/, "");
  if (maxDecimals !== undefined && frac.length > maxDecimals) {
    throw new SolanaPayUrlError(`amount "${amount}" exceeds ${maxDecimals} decimal places`);
  }
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

function assertAddress(value: string, field: string): void {
  if (!isSolanaAddress(value)) {
    throw new SolanaPayUrlError(`invalid ${field}: "${value}" is not a base58 public key`);
  }
}

function param(key: string, value: string): string {
  return `${key}=${encodeURIComponent(value)}`;
}

/**
 * Encode a transfer request. `maxDecimals` (e.g. 6 for USDC) rejects amounts
 * finer than the mint supports, as the spec requires wallets to do.
 */
export function encodeTransferRequestUrl(
  fields: TransferRequestFields,
  options: { maxDecimals?: number } = {},
): string {
  assertAddress(fields.recipient, "recipient");
  if (fields.splToken !== undefined) assertAddress(fields.splToken, "spl-token");
  for (const reference of fields.references ?? []) assertAddress(reference, "reference");

  const params = [
    ...(fields.amount !== undefined
      ? [param("amount", normalizeAmount(fields.amount, options.maxDecimals))]
      : []),
    ...(fields.splToken !== undefined ? [param("spl-token", fields.splToken)] : []),
    ...(fields.references ?? []).map((reference) => param("reference", reference)),
    ...(fields.label !== undefined ? [param("label", fields.label)] : []),
    ...(fields.message !== undefined ? [param("message", fields.message)] : []),
    ...(fields.memo !== undefined ? [param("memo", fields.memo)] : []),
  ];
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  return `${SOLANA_PAY_PROTOCOL}${fields.recipient}${query}`;
}

/**
 * Encode a transaction request. Per spec the link is URL-encoded when it
 * carries query parameters (so they are not confused with the outer URL's).
 */
export function encodeTransactionRequestUrl(fields: TransactionRequestFields): string {
  let link: URL;
  try {
    link = new URL(fields.link);
  } catch {
    throw new SolanaPayUrlError(`invalid link "${fields.link}"`);
  }
  if (link.protocol !== "https:") {
    throw new SolanaPayUrlError("transaction request link must be https");
  }
  const raw = fields.link;
  const body = link.search.length > 0 || raw.includes("%") ? encodeURIComponent(raw) : raw;
  return `${SOLANA_PAY_PROTOCOL}${body}`;
}

function parseTransfer(pathname: string, search: string): ParsedSolanaPayUrl {
  assertAddress(pathname, "recipient");
  const params = new URLSearchParams(search);

  const amountRaw = params.get("amount");
  const splToken = params.get("spl-token");
  const references = params.getAll("reference");
  const label = params.get("label");
  const message = params.get("message");
  const memo = params.get("memo");

  if (splToken !== null) assertAddress(splToken, "spl-token");
  for (const reference of references) assertAddress(reference, "reference");

  return {
    kind: "transfer",
    recipient: pathname,
    ...(amountRaw !== null ? { amount: normalizeAmount(amountRaw) } : {}),
    ...(splToken !== null ? { splToken } : {}),
    ...(references.length > 0 ? { references } : {}),
    ...(label !== null ? { label } : {}),
    ...(message !== null ? { message } : {}),
    ...(memo !== null ? { memo } : {}),
  };
}

function parseTransaction(body: string): ParsedSolanaPayUrl {
  const decoded = decodeURIComponent(body);
  let link: URL;
  try {
    link = new URL(decoded);
  } catch {
    throw new SolanaPayUrlError(`invalid transaction request link "${decoded}"`);
  }
  if (link.protocol !== "https:") {
    throw new SolanaPayUrlError("transaction request link must be https");
  }
  return { kind: "transaction", link: decoded };
}

/** Parse either Solana Pay request kind. Throws {@link SolanaPayUrlError}. */
export function parseSolanaPayUrl(url: string): ParsedSolanaPayUrl {
  if (!url.startsWith(SOLANA_PAY_PROTOCOL)) {
    throw new SolanaPayUrlError("not a solana: URL");
  }
  const rest = url.slice(SOLANA_PAY_PROTOCOL.length);
  if (rest.length === 0) throw new SolanaPayUrlError("missing recipient or link");

  // Any query on the link itself is URL-encoded (spec), so the first raw '?'
  // starts the outer query. A transaction request's link contains ':'
  // (https:) or '%' (encoded); a transfer recipient is plain base58.
  const queryAt = rest.indexOf("?");
  const pathname = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const search = queryAt === -1 ? "" : rest.slice(queryAt + 1);
  if (/[:%]/.test(pathname)) return parseTransaction(pathname);
  return parseTransfer(pathname, search);
}
