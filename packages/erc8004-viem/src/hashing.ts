/**
 * Pure, transport-free hash-derivation helpers matching the Arc ERC-8004 docs
 * scheme. Both are deterministic (`keccak256(toHex(string))`), which makes them
 * the primary unit-test seam for this package — no network, no clock, no
 * randomness.
 *
 * The on-chain ValidationRegistry/ReputationRegistry expect these exact
 * commitments, so the scheme MUST stay aligned with the deployed contracts;
 * verify with one integration run.
 */

import { keccak256, toHex } from "viem";

/** A 0x-prefixed 32-byte hex string (66 chars total). */
export type Bytes32 = `0x${string}`;

/**
 * Derive the ReputationRegistry `feedbackHash` for a feedback `tag`:
 * `keccak256(toHex(tag))`.
 */
export function feedbackHash(tag: string): Bytes32 {
  return keccak256(toHex(tag));
}

/**
 * Derive the ValidationRegistry `requestHash` for a stable `subject` string:
 * `keccak256(toHex(subject))`. The same subject always reproduces the same
 * handle, so status can be looked up later.
 */
export function requestHash(subject: string): Bytes32 {
  return keccak256(toHex(subject));
}

/** All-zero bytes32 sentinel (used where a hash is required but unknown). */
export const ZERO_BYTES32: Bytes32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
