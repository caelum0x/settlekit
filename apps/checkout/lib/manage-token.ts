/**
 * Buyer "manage subscription" links: `/s/<token>`.
 *
 * The token names one onchain subscription and its seller, HMAC-signed with
 * CHECKOUT_MANAGE_SECRET (falls back to CHECKOUT_DELIVERY_SECRET). Holding the
 * link is what lets the buyer see the subscription and cancel it, like a
 * receipt link; it cannot touch any other subscription.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

interface ManageClaims {
  /** Onchain subscription id. */
  s: string;
  /** Seller organization id. */
  o: string;
}

const DEV_SECRET = "settlekit-dev-manage-secret";

function secret(): string {
  const configured = process.env.CHECKOUT_MANAGE_SECRET?.trim() || process.env.CHECKOUT_DELIVERY_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Set CHECKOUT_MANAGE_SECRET to sign buyer subscription links.");
  }
  return DEV_SECRET;
}

function mac(payload: string): string {
  return createHmac("sha256", secret()).update(`manage:${payload}`).digest("base64url");
}

export function signManageToken(subscriptionId: string, organizationId: string): string {
  const payload = Buffer.from(JSON.stringify({ s: subscriptionId, o: organizationId } satisfies ManageClaims)).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

/** The claims of a valid token, or null. */
export function verifyManageToken(token: string): { subscriptionId: string; organizationId: string } | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ManageClaims>;
    if (typeof claims.s !== "string" || typeof claims.o !== "string") return null;
    return { subscriptionId: claims.s, organizationId: claims.o };
  } catch {
    return null;
  }
}

export function managePath(subscriptionId: string, organizationId: string): string {
  return `/s/${signManageToken(subscriptionId, organizationId)}`;
}
