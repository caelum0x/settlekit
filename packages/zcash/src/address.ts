/**
 * Zcash transparent address validation (base58check + 2-byte prefix).
 *
 * Only transparent addresses are accepted for settlement: shielded
 * (Sapling "zs…", unified "u1…") payments need a synced full node with an
 * incoming viewing key to detect, which SettleKit does not run yet.
 */

import { base58CheckDecode, base58CheckEncode } from "./base58.js";
import { ZCASH_NETWORKS, type TransparentKind, type ZcashNetwork } from "./network.js";

export type ZcashAddressResult =
  | { ok: true; address: string; network: ZcashNetwork; kind: TransparentKind; hash: Uint8Array }
  | { ok: false; reason: string };

const SHIELDED_PREFIXES = ["zs", "ztestsapling", "zc", "zt", "u1", "utest"];
const PAYLOAD_LENGTH = 22;

function matchPrefix(payload: Uint8Array): { network: ZcashNetwork; kind: TransparentKind } | null {
  for (const spec of Object.values(ZCASH_NETWORKS)) {
    for (const kind of ["p2pkh", "p2sh"] as const) {
      const [a, b] = spec.prefixes[kind];
      if (payload[0] === a && payload[1] === b) return { network: spec.network, kind };
    }
  }
  return null;
}

/** Parse and validate a Zcash transparent address. */
export function parseZcashAddress(input: string): ZcashAddressResult {
  const address = input.trim();
  const lower = address.toLowerCase();
  if (SHIELDED_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return { ok: false, reason: "shielded Zcash addresses are not yet supported; use a transparent t-address" };
  }
  const payload = base58CheckDecode(address);
  if (payload === null) return { ok: false, reason: "invalid base58check encoding or checksum" };
  if (payload.length !== PAYLOAD_LENGTH) return { ok: false, reason: "invalid transparent address length" };
  const match = matchPrefix(payload);
  if (match === null) return { ok: false, reason: "unknown Zcash address prefix" };
  return { ok: true, address, ...match, hash: payload.slice(2) };
}

/** True when `value` is a transparent address, optionally on `network`. */
export function isZcashTransparentAddress(value: string, network?: ZcashNetwork): boolean {
  const parsed = parseZcashAddress(value);
  return parsed.ok && (network === undefined || parsed.network === network);
}

/** Encode a 20-byte hash as a transparent address (used by tests/tools). */
export function encodeZcashTransparentAddress(
  network: ZcashNetwork,
  kind: TransparentKind,
  hash: Uint8Array,
): string {
  if (hash.length !== 20) throw new RangeError("transparent address hash must be 20 bytes");
  const [a, b] = ZCASH_NETWORKS[network].prefixes[kind];
  return base58CheckEncode(Uint8Array.from([a, b, ...hash]));
}
