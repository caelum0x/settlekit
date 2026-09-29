/**
 * ZIP-321 payment request URIs for transparent addresses:
 * `zcash:<address>?amount=<ZEC>&label=<label>&message=<message>`.
 *
 * Amounts are 8-decimal ZEC with trailing zeros trimmed. The `memo`
 * parameter is never emitted: ZIP-321 forbids it for transparent recipients,
 * which is why sessions are bound by a unique zatoshi amount tag instead.
 */

import { parseZcashAddress } from "./address.js";
import { formatScaled } from "./decimal.js";
import { ZCASH_DECIMALS } from "./network.js";

export interface Zip321Request {
  address: string;
  /** Amount in zatoshis. */
  amountZats: bigint;
  label?: string;
  message?: string;
}

/** Format zatoshis as a ZIP-321 amount (up to 8 dp, trailing zeros trimmed). */
export function formatZecAmount(zats: bigint): string {
  return formatScaled(zats, ZCASH_DECIMALS);
}

/** Build a single-recipient ZIP-321 URI. Throws on an invalid address/amount. */
export function buildZip321Uri(request: Zip321Request): string {
  const parsed = parseZcashAddress(request.address);
  if (!parsed.ok) throw new RangeError(`invalid Zcash address: ${parsed.reason}`);
  if (request.amountZats <= 0n) throw new RangeError("amount must be positive");
  const params = [`amount=${formatZecAmount(request.amountZats)}`];
  if (request.label !== undefined && request.label.length > 0) {
    params.push(`label=${encodeURIComponent(request.label)}`);
  }
  if (request.message !== undefined && request.message.length > 0) {
    params.push(`message=${encodeURIComponent(request.message)}`);
  }
  return `zcash:${parsed.address}?${params.join("&")}`;
}
