import { createHmac, timingSafeEqual } from "node:crypto";
import type { ParsedSignature } from "./types.js";

/** Header name carrying the Stripe-style signature on outbound deliveries. */
export const SIGNATURE_HEADER = "SettleKit-Signature";

/** Header name carrying the event type on outbound deliveries. */
export const EVENT_HEADER = "SettleKit-Event";

/**
 * The signed message is `"<timestamp>.<payloadJson>"`. Binding the timestamp
 * into the HMAC input prevents an attacker from replaying an old signature with
 * a fresh timestamp.
 */
function signedMessage(payloadJson: string, timestamp: number): string {
  return `${timestamp}.${payloadJson}`;
}

/** Compute the hex HMAC-SHA256 of the signed message. */
function computeHmac(secret: string, payloadJson: string, timestamp: number): string {
  return createHmac("sha256", secret).update(signedMessage(payloadJson, timestamp)).digest("hex");
}

/**
 * Produce a Stripe-style signature header value for a payload:
 * `t=<timestamp>,v1=<hex-hmac-sha256>`.
 *
 * @param secret The endpoint's signing secret.
 * @param payloadJson The exact JSON string that will be sent as the body.
 * @param timestamp Unix timestamp in seconds.
 */
export function signPayload(secret: string, payloadJson: string, timestamp: number): string {
  const v1 = computeHmac(secret, payloadJson, timestamp);
  return `t=${timestamp},v1=${v1}`;
}

/**
 * Parse a `t=<ts>,v1=<hex>` header into its components. Returns `null` when the
 * header is malformed or missing either field.
 */
export function parseSignatureHeader(header: string): ParsedSignature | null {
  let timestamp: number | null = null;
  let signature: string | null = null;

  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isInteger(parsed) && /^\d+$/.test(value)) timestamp = parsed;
    } else if (key === "v1") {
      if (/^[0-9a-f]+$/i.test(value) && value.length > 0) signature = value;
    }
  }

  if (timestamp === null || signature === null) return null;
  return { timestamp, signature };
}

/** Constant-time hex string comparison. Length mismatch short-circuits to false. */
function safeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a signature header against a payload using a constant-time comparison.
 *
 * @param secret The endpoint's signing secret.
 * @param payloadJson The exact JSON string that was received as the body.
 * @param header The raw `SettleKit-Signature` header value.
 * @param toleranceSec Max allowed age of the signature in seconds. Pass `0` or a
 *   negative number to disable the freshness check.
 * @param now Unix timestamp (seconds) representing "now"; defaults to wall clock.
 */
export function verifySignature(
  secret: string,
  payloadJson: string,
  header: string,
  toleranceSec: number,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const parsed = parseSignatureHeader(header);
  if (parsed === null) return false;

  if (toleranceSec > 0) {
    const age = Math.abs(now - parsed.timestamp);
    if (age > toleranceSec) return false;
  }

  const expected = computeHmac(secret, payloadJson, parsed.timestamp);
  return safeHexEqual(expected, parsed.signature);
}
