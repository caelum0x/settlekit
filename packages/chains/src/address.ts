/**
 * Per-network payTo validation (browser-safe).
 *
 * EVM: viem `isAddress` in strict mode (a mixed-case address must carry a
 * valid EIP-55 checksum) and never the zero address. Solana: base58 that
 * decodes to 32 bytes. Zcash: a transparent base58check address on the
 * expected network (shielded addresses are rejected for now).
 */

import { isAddress, zeroAddress } from "viem";
import type { PaymentNetwork } from "@settlekit/common";
import { base58Decode, parseZcashAddress, type ZcashNetwork } from "@settlekit/zcash";
import { networkFamily } from "./networks.js";

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type PayToCheck = { ok: true } | { ok: false; reason: string };

export function isValidEvmAddress(value: string): boolean {
  return isAddress(value, { strict: true }) && value.toLowerCase() !== zeroAddress;
}

export function isValidSolanaAddress(value: string): boolean {
  if (!SOLANA_ADDRESS_RE.test(value)) return false;
  return base58Decode(value)?.length === 32;
}

export interface PayToOptions {
  /** Network the Zcash address must belong to (default mainnet). */
  zcashNetwork?: ZcashNetwork;
}

/** Validate `address` as a payment destination on `network`. */
export function checkPayTo(network: PaymentNetwork, address: string, options: PayToOptions = {}): PayToCheck {
  const value = address.trim();
  switch (networkFamily(network)) {
    case "evm":
      return isValidEvmAddress(value)
        ? { ok: true }
        : { ok: false, reason: `must be a checksummed, non-zero 0x address for network ${network}` };
    case "solana":
      return isValidSolanaAddress(value)
        ? { ok: true }
        : { ok: false, reason: "must be a base58 Solana wallet address for network solana" };
    case "zcash": {
      const parsed = parseZcashAddress(value);
      if (!parsed.ok) return { ok: false, reason: parsed.reason };
      const expected = options.zcashNetwork ?? "mainnet";
      return parsed.network === expected
        ? { ok: true }
        : { ok: false, reason: `must be a Zcash ${expected} transparent address` };
    }
  }
}

/** Boolean form of {@link checkPayTo}. */
export function isValidPayTo(network: PaymentNetwork, address: string, options: PayToOptions = {}): boolean {
  return checkPayTo(network, address, options).ok;
}
