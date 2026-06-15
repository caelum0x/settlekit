import { createHmac, timingSafeEqual } from "node:crypto";

/** Separator between the cookie value and its signature. */
const SEPARATOR = ".";

/**
 * Sign `value` with `secret` using HMAC-SHA256, producing a stateless,
 * tamper-evident cookie of the form `<base64url(value)>.<base64url(mac)>`.
 *
 * Encoding the value as base64url keeps the result free of the separator and
 * cookie-unsafe characters, so {@link verifyCookie} can split it unambiguously.
 */
export function signCookie(value: string, secret: string): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("Cookie signing secret must be a non-empty string");
  }
  const encodedValue = Buffer.from(value, "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(encodedValue).digest("base64url");
  return `${encodedValue}${SEPARATOR}${mac}`;
}

/**
 * Verify a signed cookie produced by {@link signCookie} and return the original
 * value, or `null` if the signature is missing, malformed, or invalid.
 *
 * The MAC comparison uses {@link timingSafeEqual} to avoid timing side channels.
 */
export function verifyCookie(signed: string, secret: string): string | null {
  if (
    typeof signed !== "string" ||
    signed.length === 0 ||
    typeof secret !== "string" ||
    secret.length === 0
  ) {
    return null;
  }

  const sepIndex = signed.indexOf(SEPARATOR);
  if (sepIndex <= 0 || sepIndex === signed.length - 1) {
    return null;
  }

  const encodedValue = signed.slice(0, sepIndex);
  const presentedMac = signed.slice(sepIndex + 1);
  const expectedMac = createHmac("sha256", secret).update(encodedValue).digest("base64url");

  const presented = Buffer.from(presentedMac, "base64url");
  const expected = Buffer.from(expectedMac, "base64url");
  if (presented.length !== expected.length || presented.length === 0) {
    return null;
  }
  if (!timingSafeEqual(presented, expected)) {
    return null;
  }

  return Buffer.from(encodedValue, "base64url").toString("utf8");
}
