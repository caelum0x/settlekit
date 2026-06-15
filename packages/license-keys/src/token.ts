import { createHmac, timingSafeEqual } from "node:crypto";
import { isPast, type LicenseKey } from "@settlekit/common";
import type { LicenseTokenPayload } from "./types.js";

/**
 * Offline validation tokens are `base64url(payload).base64url(hmacSha256)`.
 * Apps embed the shared HMAC secret and validate without contacting the server.
 */
const TOKEN_SEPARATOR = ".";

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(secret: string, message: string): Buffer {
  return createHmac("sha256", secret).update(message).digest();
}

/** Build the compact payload that travels inside an offline token. */
export function tokenPayloadFor(license: LicenseKey, now: Date = new Date()): LicenseTokenPayload {
  return {
    lid: license.id,
    productId: license.productId,
    customerId: license.customerId,
    expiresAt: license.expiresAt ?? null,
    machineLimit: license.machineLimit,
    iat: now.getTime(),
  };
}

/**
 * Sign a license payload with HMAC-SHA256, producing a compact, URL-safe token
 * that an application can verify offline using the same secret.
 */
export function signLicenseToken(payload: LicenseTokenPayload, secret: string): string {
  if (!secret) throw new Error("signing secret must be a non-empty string");
  const encodedPayload = b64url(JSON.stringify(payload));
  const signature = b64url(hmac(secret, encodedPayload));
  return `${encodedPayload}${TOKEN_SEPARATOR}${signature}`;
}

/** Convenience: build the payload from a license and sign it in one step. */
export function issueLicenseToken(license: LicenseKey, secret: string, now: Date = new Date()): string {
  return signLicenseToken(tokenPayloadFor(license, now), secret);
}

export type VerifyTokenResult =
  | { valid: true; payload: LicenseTokenPayload }
  | { valid: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * Verify an offline token. Performs a constant-time signature comparison to
 * resist timing attacks, then enforces the embedded expiry.
 */
export function verifyLicenseToken(token: string, secret: string, now: Date = new Date()): VerifyTokenResult {
  if (!secret) throw new Error("verification secret must be a non-empty string");

  const parts = token.split(TOKEN_SEPARATOR);
  if (parts.length !== 2) return { valid: false, reason: "malformed" };
  const [encodedPayload, signature] = parts as [string, string];
  if (encodedPayload.length === 0 || signature.length === 0) {
    return { valid: false, reason: "malformed" };
  }

  const expected = b64url(hmac(secret, encodedPayload));
  const provided = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: LicenseTokenPayload;
  try {
    const raw = Buffer.from(encodedPayload, "base64url").toString("utf8");
    payload = JSON.parse(raw) as LicenseTokenPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.lid !== "string" ||
    typeof payload.productId !== "string" ||
    typeof payload.customerId !== "string"
  ) {
    return { valid: false, reason: "malformed" };
  }

  if (payload.expiresAt !== null && isPast(payload.expiresAt, now)) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}
