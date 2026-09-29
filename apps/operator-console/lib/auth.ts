/**
 * Owner authentication for the console: a single owner password (env) and a
 * stateless HMAC-signed session cookie. Pure functions over node:crypto so
 * they are unit-testable; the Next glue lives in ./session.ts.
 *
 * Token format: `v1.<expiresAtMs>.<nonce>.<hmacSha256Hex>` where the HMAC
 * covers `v1.<expiresAtMs>.<nonce>`.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OWNER_COOKIE = "tameion_owner";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const VERSION = "v1";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time password check (hashing first equalises lengths). */
export function checkPassword(given: string, expected: string | null): boolean {
  if (!expected || given.length === 0) return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function createSessionToken(secret: string, now: Date, ttlMs: number = SESSION_TTL_MS, nonce: string = randomBytes(16).toString("hex")): string {
  const payload = `${VERSION}.${now.getTime() + ttlMs}.${nonce}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** True when the token is well-formed, correctly signed and unexpired. */
export function verifySessionToken(token: string | undefined | null, secret: string | null, now: Date): boolean {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return false;
  const [version, expires, nonce, mac] = parts as [string, string, string, string];
  if (!/^\d+$/.test(expires) || !/^[a-f0-9]{16,}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(mac)) return false;
  const expected = Buffer.from(sign(`${version}.${expires}.${nonce}`, secret), "hex");
  const actual = Buffer.from(mac, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  return Number(expires) > now.getTime();
}

/** Only same-origin absolute paths are allowed as post-login redirects. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
