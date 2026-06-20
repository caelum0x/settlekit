/**
 * Sign-In-With-Ethereum (SIWE / EIP-4361) primitives for web3 login.
 *
 * Auth flow:
 *  1. client requests a nonce for its wallet address ({@link AuthService.requestWalletNonce});
 *  2. client builds a SIWE message embedding that nonce ({@link buildSiweMessage})
 *     and signs it with the wallet;
 *  3. server verifies the signature, consumes the single-use nonce, and opens a
 *     session ({@link AuthService.loginWithWallet}).
 *
 * Verification is offline EOA recovery (`recoverMessageAddress`): no RPC, no new
 * dependency beyond viem (already in the workspace). Smart-account (ERC-1271)
 * verification would need a chain client and is out of scope here.
 */

import { getAddress, isAddress, recoverMessageAddress } from "viem";
import type { Hex } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";

/** Generate a fresh, random SIWE nonce. */
export function generateWalletNonce(): string {
  return generateSiweNonce();
}

/**
 * Validate and EIP-55-checksum a wallet address. Throws on malformed input so
 * callers can map it to a validation error.
 */
export function normalizeWalletAddress(address: string): string {
  if (typeof address !== "string" || !isAddress(address)) {
    throw new Error("Invalid wallet address");
  }
  return getAddress(address);
}

/** Parameters for {@link buildSiweMessage} (mirrors the EIP-4361 fields). */
export interface BuildSiweMessageParams {
  address: string;
  /** RFC 4501 dnsauthority the sign-in is bound to, e.g. "app.settlekit.com". */
  domain: string;
  /** Full URI the sign-in originates from, e.g. "https://app.settlekit.com". */
  uri: string;
  /** EVM chain id the message is scoped to. */
  chainId: number;
  /** Single-use nonce issued by {@link generateWalletNonce}. */
  nonce: string;
  /** Human-readable statement shown in the wallet. */
  statement?: string;
  issuedAt?: Date;
  expirationTime?: Date;
}

/** Build a canonical EIP-4361 SIWE message string for the wallet to sign. */
export function buildSiweMessage(params: BuildSiweMessageParams): string {
  return createSiweMessage({
    address: getAddress(params.address),
    domain: params.domain,
    uri: params.uri,
    chainId: params.chainId,
    nonce: params.nonce,
    version: "1",
    ...(params.statement !== undefined ? { statement: params.statement } : {}),
    ...(params.issuedAt !== undefined ? { issuedAt: params.issuedAt } : {}),
    ...(params.expirationTime !== undefined ? { expirationTime: params.expirationTime } : {}),
  });
}

/** Fields recovered from a signed SIWE message that the server checks. */
export interface ParsedSiweFields {
  address?: string;
  nonce?: string;
  domain?: string;
  chainId?: number;
  expirationTime?: Date;
}

/** Parse a SIWE message string into its structured fields. */
export function parseWalletMessage(message: string): ParsedSiweFields {
  const parsed = parseSiweMessage(message);
  return {
    ...(parsed.address !== undefined ? { address: parsed.address } : {}),
    ...(parsed.nonce !== undefined ? { nonce: parsed.nonce } : {}),
    ...(parsed.domain !== undefined ? { domain: parsed.domain } : {}),
    ...(parsed.chainId !== undefined ? { chainId: parsed.chainId } : {}),
    ...(parsed.expirationTime !== undefined ? { expirationTime: parsed.expirationTime } : {}),
  };
}

/**
 * Recover the signer of a SIWE message (offline EOA ec-recover) and return its
 * checksummed address. Throws if the signature is malformed.
 */
export async function recoverWalletSigner(message: string, signature: Hex): Promise<string> {
  const recovered = await recoverMessageAddress({ message, signature });
  return getAddress(recovered);
}
