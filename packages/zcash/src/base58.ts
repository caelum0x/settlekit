/**
 * Bitcoin-alphabet base58 and base58check (double-SHA256 checksum), as used
 * by Zcash transparent addresses. Pure and browser-safe.
 */

import { sha256 } from "viem";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX: ReadonlyMap<string, number> = new Map(
  [...ALPHABET].map((char, index) => [char, index] as const),
);

/** Encode bytes as base58 (leading zero bytes become leading "1"s). */
export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  return "1".repeat(zeros) + out;
}

/** Decode base58, or `null` when `text` has characters outside the alphabet. */
export function base58Decode(text: string): Uint8Array | null {
  let value = 0n;
  for (const char of text) {
    const digit = INDEX.get(char);
    if (digit === undefined) return null;
    value = value * 58n + BigInt(digit);
  }
  const body: number[] = [];
  while (value > 0n) {
    body.unshift(Number(value % 256n));
    value /= 256n;
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...body]);
}

/** First four bytes of SHA256(SHA256(payload)). */
export function checksum4(payload: Uint8Array): Uint8Array {
  return sha256(sha256(payload, "bytes"), "bytes").slice(0, 4);
}

/** base58check-encode `payload` (checksum appended). */
export function base58CheckEncode(payload: Uint8Array): string {
  const sum = checksum4(payload);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload, 0);
  full.set(sum, payload.length);
  return base58Encode(full);
}

/** Decode base58check, returning the payload or `null` on a bad checksum. */
export function base58CheckDecode(text: string): Uint8Array | null {
  const full = base58Decode(text);
  if (full === null || full.length < 5) return null;
  const payload = full.slice(0, -4);
  const expected = checksum4(payload);
  const actual = full.slice(-4);
  for (let i = 0; i < 4; i += 1) {
    if (expected[i] !== actual[i]) return null;
  }
  return payload;
}
