/**
 * HyperCore `usdSend` as EIP-712 typed data (Hyperliquid "user-signed"
 * actions), identical to what `@nktkas/hyperliquid`'s `usdSend` signs:
 *
 *   domain  { name: "HyperliquidSignTransaction", version: "1",
 *             chainId: <signatureChainId>, verifyingContract: 0x0 }
 *   type    HyperliquidTransaction:UsdSend(string hyperliquidChain,
 *             string destination, string amount, uint64 time)
 *
 * Any EVM wallet (EIP-6963) can sign it on whatever chain it is connected
 * to; `signatureChainId` records that chain so Hyperliquid can recover the
 * signer. The golden vectors in test/ pin the digest and signature against
 * the SDK's own signer.
 */

import { getAddress, hashTypedData, isAddress, recoverTypedDataAddress, type Hex } from "viem";
import type { HyperliquidChain } from "./env.js";

export const HYPERLIQUID_SIGN_DOMAIN_NAME = "HyperliquidSignTransaction";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const USD_SEND_PRIMARY_TYPE = "HyperliquidTransaction:UsdSend" as const;

export const USD_SEND_TYPES = {
  [USD_SEND_PRIMARY_TYPE]: [
    { name: "hyperliquidChain", type: "string" },
    { name: "destination", type: "string" },
    { name: "amount", type: "string" },
    { name: "time", type: "uint64" },
  ],
} as const;

/** The exact action object Hyperliquid's /exchange expects (key order matters). */
export interface UsdSendAction {
  type: "usdSend";
  signatureChainId: Hex;
  hyperliquidChain: HyperliquidChain;
  /** Lowercase 0x address. */
  destination: Hex;
  /** Canonical decimal USD amount ("1" = $1, no trailing zeros). */
  amount: string;
  /** Nonce: unix ms, also the replay guard. */
  time: number;
}

export interface Signature {
  r: Hex;
  s: Hex;
  v: 27 | 28;
}

export class UsdSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsdSendError";
  }
}

const DECIMAL_RE = /^(0|[1-9]\d*)(\.\d+)?$/;
const HEX_CHAIN_RE = /^0x[0-9a-fA-F]{1,16}$/;

/** "25.50" → "25.5", "10.000000" → "10": the canonical amount string to sign. */
export function canonicalUsdAmount(amount: string): string {
  const value = amount.trim();
  if (!DECIMAL_RE.test(value)) throw new UsdSendError(`amount must be a positive decimal string, got "${amount}"`);
  const [whole, frac = ""] = value.split(".");
  const trimmed = frac.replace(/0+$/, "");
  const canonical = trimmed.length > 0 ? `${whole}.${trimmed}` : (whole as string);
  if (/^0(\.0*)?$/.test(canonical)) throw new UsdSendError("amount must be greater than zero");
  return canonical;
}

export interface BuildUsdSendInput {
  destination: string;
  amount: string;
  time: number;
  hyperliquidChain: HyperliquidChain;
  /** Chain id the signing wallet is on, as a number or 0x hex. */
  signatureChainId: number | string;
}

function toHexChainId(value: number | string): Hex {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) throw new UsdSendError("signatureChainId must be a positive integer");
    return `0x${value.toString(16)}` as Hex;
  }
  if (!HEX_CHAIN_RE.test(value) || Number.parseInt(value, 16) <= 0) {
    throw new UsdSendError("signatureChainId must be a 0x-prefixed hex chain id");
  }
  return `0x${Number.parseInt(value, 16).toString(16)}` as Hex;
}

/** Build (and validate) a `usdSend` action. */
export function buildUsdSendAction(input: BuildUsdSendInput): UsdSendAction {
  if (!isAddress(input.destination, { strict: false })) throw new UsdSendError("destination must be a 0x address");
  if (!Number.isSafeInteger(input.time) || input.time <= 0) throw new UsdSendError("time must be a unix-ms integer");
  if (input.hyperliquidChain !== "Mainnet" && input.hyperliquidChain !== "Testnet") {
    throw new UsdSendError("hyperliquidChain must be Mainnet or Testnet");
  }
  return {
    type: "usdSend",
    signatureChainId: toHexChainId(input.signatureChainId),
    hyperliquidChain: input.hyperliquidChain,
    destination: input.destination.toLowerCase() as Hex,
    amount: canonicalUsdAmount(input.amount),
    time: input.time,
  };
}

/** The EIP-712 payload a wallet signs for `action` (eth_signTypedData_v4 shape). */
export function usdSendTypedData(action: UsdSendAction) {
  return {
    domain: {
      name: HYPERLIQUID_SIGN_DOMAIN_NAME,
      version: "1",
      chainId: Number.parseInt(action.signatureChainId, 16),
      verifyingContract: ZERO_ADDRESS,
    },
    types: USD_SEND_TYPES,
    primaryType: USD_SEND_PRIMARY_TYPE,
    message: {
      hyperliquidChain: action.hyperliquidChain,
      destination: action.destination,
      amount: action.amount,
      time: BigInt(action.time),
    },
  } as const;
}

/** EIP-712 digest of `action`. */
export function usdSendDigest(action: UsdSendAction): Hex {
  return hashTypedData(usdSendTypedData(action));
}

/** Split a 65-byte 0x signature into Hyperliquid's `{ r, s, v }`. */
export function splitSignature(signature: string): Signature {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new UsdSendError("signature must be 65 bytes of 0x hex");
  const r = `0x${signature.slice(2, 66)}`.toLowerCase() as Hex;
  const s = `0x${signature.slice(66, 130)}`.toLowerCase() as Hex;
  let v = Number.parseInt(signature.slice(130, 132), 16);
  if (v < 27) v += 27;
  if (v !== 27 && v !== 28) throw new UsdSendError("signature recovery id must be 27 or 28");
  return { r, s, v };
}

/** Join `{ r, s, v }` back into a 65-byte hex signature. */
export function joinSignature(signature: Signature): Hex {
  return `${signature.r}${signature.s.slice(2)}${signature.v.toString(16).padStart(2, "0")}` as Hex;
}

/** The address that signed `action` (checksummed). */
export async function recoverUsdSendSigner(action: UsdSendAction, signature: Signature | string): Promise<Hex> {
  const sig = typeof signature === "string" ? splitSignature(signature) : signature;
  const address = await recoverTypedDataAddress({ ...usdSendTypedData(action), signature: joinSignature(sig) });
  return getAddress(address);
}
