/**
 * Pure account / private-key derivation — testable without a transport.
 *
 * Keys are NEVER hardcoded here and NEVER read from `process.env` here: the
 * factory layer is responsible for pulling a key from the environment (see
 * {@link readPrivateKeyFromEnv}) and passing it in via config. This module only
 * validates and derives.
 */

import { privateKeyToAccount } from "viem/accounts";
import type { Account } from "viem";
import { validationError } from "@settlekit/common";
import type { Hex } from "./types.js";

/** A 0x-prefixed 32-byte (64 hex char) private key. */
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

/** Inputs accepted by {@link resolveAccount}. */
export interface ResolveAccountInput {
  /** A pre-built account (preferred over `privateKey` when both are present). */
  account?: Account;
  /** A 0x private key turned into an account via viem `privateKeyToAccount`. */
  privateKey?: Hex;
}

/** Whether a string is a syntactically valid 0x + 64-hex private key. */
export function isPrivateKey(value: string): value is Hex {
  return PRIVATE_KEY_RE.test(value);
}

/**
 * Resolve a viem {@link Account} from config: prefer an injected account; else
 * derive one from a validated private key. Throws `validation_error` when the
 * key is malformed or when neither is supplied.
 */
export function resolveAccount(input: ResolveAccountInput): Account {
  if (input.account) {
    return input.account;
  }
  if (input.privateKey === undefined) {
    throw validationError("No signer: supply config.account or config.privateKey.");
  }
  if (!isPrivateKey(input.privateKey)) {
    throw validationError("privateKey must be a 0x-prefixed 64-hex-character string.");
  }
  return privateKeyToAccount(input.privateKey);
}

/**
 * Read a private key from an environment map (e.g. `process.env`) for the
 * factory layer to pass into config. Returns `undefined` when unset (no throw)
 * so callers decide whether a missing key is an error. Never logs the value.
 */
export function readPrivateKeyFromEnv(
  env: Record<string, string | undefined>,
  varName = "ERC8183_PRIVATE_KEY",
): Hex | undefined {
  const value = env[varName];
  if (value === undefined || value === "") {
    return undefined;
  }
  if (!isPrivateKey(value)) {
    throw validationError(
      `${varName} must be a 0x-prefixed 64-hex-character private key.`,
    );
  }
  return value;
}
