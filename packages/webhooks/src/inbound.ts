/**
 * Inbound webhook verification for **Circle** notifications.
 *
 * This is a DIFFERENT scheme from SettleKit's own outbound signing
 * (`signing.ts`, HMAC-SHA256). Circle signs each notification with **ECDSA over
 * SHA-256** and a rotating EC key:
 *   - `X-Circle-Signature`: base64 ECDSA (DER) signature of the raw JSON body
 *   - `X-Circle-Key-Id`: UUID of the public key to verify with
 * The public key (base64-encoded SPKI DER) is fetched from
 * `GET https://api.circle.com/v2/notifications/publicKey/{keyId}`.
 *
 * This module is pure crypto + parsing; fetching/caching the public key and
 * routing events live in the API layer.
 *
 * Source: https://developers.circle.com/wallets/webhook-notifications
 */
import { createPublicKey, verify } from "node:crypto";

/** A Circle notification public key, as returned by Circle. */
export interface CirclePublicKey {
  id: string;
  /** Always "ECDSA_SHA_256" today. */
  algorithm: string;
  /** Base64-encoded SPKI (DER) public key. */
  publicKey: string;
  createDate?: string;
}

/** The envelope Circle POSTs to a webhook subscription. */
export interface CircleNotification {
  /** Unique id of this notification — use it to dedupe. */
  notificationId?: string;
  /** e.g. "transactions.inbound", "transactions.outbound". */
  notificationType?: string;
  subscriptionId?: string;
  /** The typed payload (a transaction, a screening result, …). */
  notification?: Record<string, unknown>;
  timestamp?: string;
  version?: number;
}

/**
 * Verify a Circle webhook signature over the EXACT raw request body. Returns
 * false on any malformed key/signature rather than throwing, so a bad
 * notification is rejected cleanly. ECDSA signatures are DER-encoded (Node's
 * default), matching Circle.
 */
export function verifyCircleSignature(
  rawBody: string,
  signatureBase64: string,
  publicKeyBase64Spki: string,
): boolean {
  if (!rawBody || !signatureBase64 || !publicKeyBase64Spki) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyBase64Spki, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(
      "sha256",
      Buffer.from(rawBody, "utf8"),
      key,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

/** Parse a Circle notification body; returns null on invalid JSON. */
export function parseCircleNotification(rawBody: string): CircleNotification | null {
  try {
    const parsed = JSON.parse(rawBody);
    return typeof parsed === "object" && parsed !== null ? (parsed as CircleNotification) : null;
  } catch {
    return null;
  }
}

/** A Circle transaction as surfaced inside a `transactions.*` notification. */
export interface CircleTransactionNotification {
  id?: string;
  state?: string;
  txHash?: string;
  /** The caller reference SettleKit set on the transfer (e.g. the payout id). */
  refId?: string;
  amounts?: string[];
  destinationAddress?: string;
}

/** Extract the transaction payload from a `transactions.*` notification. */
export function extractTransaction(
  notification: CircleNotification,
): CircleTransactionNotification | null {
  const payload = notification.notification;
  if (!payload || typeof payload !== "object") return null;
  return payload as CircleTransactionNotification;
}
