/**
 * Proof-of-citation.
 *
 * After an agent pays a citation toll, it can present a signed, expiring proof
 * to a downstream seller (or drop it in an audit log) attesting *which* sources
 * it cited and under which paid-access event — verifiable with a shared secret,
 * without trusting the agent or re-querying the settlement chain. The signature
 * is an HMAC-SHA256 over a canonical encoding of the claim, so two parties that
 * share the secret always agree on the bytes being signed.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  type IsoTimestamp,
  type Result,
  SettleKitError,
  err,
  isPast,
  ok,
  toIso,
} from "@settlekit/common";
import type { CitationProof, IssueProofInput, ProofClaim } from "./types.js";

/**
 * Canonical encoding of a claim. Field order is fixed and `sourceIds` is sorted,
 * so the same logical claim always serializes to the same bytes regardless of
 * how the caller ordered things. Undefined optionals are omitted.
 */
function canonicalize(claim: ProofClaim): string {
  const ordered: Array<[string, unknown]> = [
    ["agent", claim.agent],
    ["sourceIds", [...claim.sourceIds].sort()],
    ["accessId", claim.accessId],
    ["issuedAt", claim.issuedAt],
    ["nonce", claim.nonce],
  ];
  if (claim.amountUsdc !== undefined) {
    ordered.push(["amountUsdc", claim.amountUsdc]);
  }
  if (claim.expiresAt !== undefined) {
    ordered.push(["expiresAt", claim.expiresAt]);
  }
  return JSON.stringify(ordered);
}

/** HMAC-SHA256 of the canonical claim, hex-encoded. */
export function signClaim(claim: ProofClaim, secret: string): string {
  return createHmac("sha256", secret).update(canonicalize(claim)).digest("hex");
}

/** Attach a signature to a claim, producing a presentable {@link CitationProof}. */
export function signCitationProof(claim: ProofClaim, secret: string): CitationProof {
  return { ...claim, signature: signClaim(claim, secret) };
}

/**
 * Build and sign a fresh proof. Generates the nonce and `issuedAt`/`expiresAt`
 * timestamps from `now`, then signs.
 */
export function issueCitationProof(
  input: IssueProofInput,
  secret: string,
  now: Date = new Date(),
): CitationProof {
  const issuedAt: IsoTimestamp = toIso(now);
  const claim: ProofClaim = {
    agent: input.agent,
    sourceIds: input.sourceIds,
    accessId: input.accessId,
    ...(input.amountUsdc !== undefined ? { amountUsdc: input.amountUsdc } : {}),
    issuedAt,
    ...(input.ttlSeconds !== undefined
      ? { expiresAt: toIso(new Date(now.getTime() + input.ttlSeconds * 1000)) }
      : {}),
    nonce: randomUUID(),
  };
  return signCitationProof(claim, secret);
}

/** Constant-time comparison of two hex signatures of equal length. */
function signaturesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * Verify a proof's signature and expiry. Returns the underlying claim on
 * success, or an `unauthorized` error when the signature is forged or the proof
 * has expired.
 */
export function verifyCitationProof(
  proof: CitationProof,
  secret: string,
  now: Date = new Date(),
): Result<ProofClaim, SettleKitError> {
  const { signature, ...claim } = proof;
  const expected = signClaim(claim, secret);
  if (!signaturesEqual(signature, expected)) {
    return err(new SettleKitError({ code: "unauthorized", message: "invalid citation proof signature" }));
  }
  if (claim.expiresAt !== undefined && isPast(claim.expiresAt, now)) {
    return err(new SettleKitError({ code: "unauthorized", message: "citation proof expired" }));
  }
  return ok(claim);
}
