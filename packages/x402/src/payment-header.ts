/**
 * Parsing the inbound `X-Payment` proof-of-payment header.
 *
 * The header value is base64-encoded JSON describing the settling transfer:
 *   { txHash, from, amount, network, nonce }
 */

import { err, ok, type Result } from "@settlekit/common";
import { PAYMENT_HEADER, type PaymentProof, type X402Network } from "./types.js";

const VALID_NETWORKS: ReadonlyArray<X402Network> = ["arc", "base", "ethereum"];

function isX402Network(value: unknown): value is X402Network {
  return typeof value === "string" && (VALID_NETWORKS as readonly string[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function decodeBase64(value: string): string {
  // Prefer Node's Buffer when available; fall back to the web atob.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf-8");
  }
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  throw new Error("No base64 decoder available in this runtime");
}

/**
 * Validate a decoded object into a {@link PaymentProof}. Returns a typed error
 * Result rather than throwing so callers can branch on malformed input.
 */
export function parsePaymentProof(value: unknown): Result<PaymentProof, string> {
  if (typeof value !== "object" || value === null) {
    return err("payment proof is not an object");
  }
  const record = value as Record<string, unknown>;

  if (!isNonEmptyString(record["txHash"])) {
    return err('payment proof "txHash" is required');
  }
  if (!isNonEmptyString(record["from"])) {
    return err('payment proof "from" is required');
  }
  if (!isNonEmptyString(record["amount"])) {
    return err('payment proof "amount" is required');
  }
  if (!isX402Network(record["network"])) {
    return err('payment proof "network" is invalid');
  }
  if (!isNonEmptyString(record["nonce"])) {
    return err('payment proof "nonce" is required');
  }

  return ok({
    txHash: record["txHash"],
    from: record["from"],
    amount: record["amount"],
    network: record["network"],
    nonce: record["nonce"],
  });
}

/**
 * Read and decode the `X-Payment` header from a web `Request`.
 *
 * Returns:
 *  - `ok(null)`        when the header is absent (the caller should challenge),
 *  - `ok(PaymentProof)` when present and well-formed,
 *  - `err(reason)`     when present but malformed (bad base64 / JSON / shape).
 */
export function parsePaymentHeader(request: Request): Result<PaymentProof | null, string> {
  const raw = request.headers.get(PAYMENT_HEADER);
  if (raw === null || raw.length === 0) {
    return ok(null);
  }

  let json: string;
  try {
    json = decodeBase64(raw);
  } catch {
    return err(`${PAYMENT_HEADER} header is not valid base64`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return err(`${PAYMENT_HEADER} header is not valid JSON`);
  }

  return parsePaymentProof(parsed);
}

/**
 * Encode a {@link PaymentProof} into the base64-JSON value used for the
 * `X-Payment` header. Useful for clients (and tests) constructing a paid retry.
 */
export function encodePaymentHeader(proof: PaymentProof): string {
  const json = JSON.stringify(proof);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf-8").toString("base64");
  }
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  throw new Error("No base64 encoder available in this runtime");
}
