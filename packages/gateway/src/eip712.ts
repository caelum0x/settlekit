/**
 * EIP-712 typed-data definitions for the Circle Gateway `BurnIntent`.
 *
 * Circle's `GatewayWallet` intentionally omits `chainId` and `verifyingContract`
 * from the domain separator so a single burn-intent signature is valid across
 * chains and deployments. The domain therefore carries only `name` + `version`.
 *
 * @see https://github.com/circlefin/evm-gateway-contracts `src/lib/EIP712Domain.sol`
 * @see https://github.com/circlefin/evm-gateway-contracts `src/lib/BurnIntents.sol`
 */

import { hashTypedData } from "viem";
import type { BurnIntent } from "./types.js";

/** The cross-chain EIP-712 domain used to sign Gateway burn intents. */
export const GATEWAY_EIP712_DOMAIN = {
  name: "GatewayWallet",
  version: "1",
} as const;

/**
 * EIP-712 type definitions for `BurnIntent` and the embedded `TransferSpec`.
 * Field order matches the Solidity struct definitions exactly; reordering would
 * change the type hash and invalidate signatures.
 */
export const GATEWAY_EIP712_TYPES = {
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
} as const;

/** The message shape EIP-712 signing expects (bigint amounts). */
export interface BurnIntentMessage {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    sourceContract: `0x${string}`;
    destinationContract: `0x${string}`;
    sourceToken: `0x${string}`;
    destinationToken: `0x${string}`;
    sourceDepositor: `0x${string}`;
    destinationRecipient: `0x${string}`;
    sourceSigner: `0x${string}`;
    destinationCaller: `0x${string}`;
    value: bigint;
    salt: `0x${string}`;
    hookData: `0x${string}`;
  };
}

/** Convert a {@link BurnIntent} into the message object EIP-712 signing expects. */
function toTypedMessage(intent: BurnIntent): BurnIntentMessage {
  return {
    maxBlockHeight: BigInt(intent.maxBlockHeight),
    maxFee: BigInt(intent.maxFee),
    spec: {
      version: intent.spec.version,
      sourceDomain: intent.spec.sourceDomain,
      destinationDomain: intent.spec.destinationDomain,
      sourceContract: intent.spec.sourceContract,
      destinationContract: intent.spec.destinationContract,
      sourceToken: intent.spec.sourceToken,
      destinationToken: intent.spec.destinationToken,
      sourceDepositor: intent.spec.sourceDepositor,
      destinationRecipient: intent.spec.destinationRecipient,
      sourceSigner: intent.spec.sourceSigner,
      destinationCaller: intent.spec.destinationCaller,
      value: BigInt(intent.spec.value),
      salt: intent.spec.salt,
      hookData: intent.spec.hookData,
    },
  };
}

/**
 * The fully-typed EIP-712 payload for a burn intent. Hand this directly to a
 * viem wallet client's `signTypedData`, or to {@link burnIntentDigest} to derive
 * the digest deterministically.
 */
export function burnIntentTypedData(intent: BurnIntent): {
  domain: typeof GATEWAY_EIP712_DOMAIN;
  types: typeof GATEWAY_EIP712_TYPES;
  primaryType: "BurnIntent";
  message: BurnIntentMessage;
} {
  return {
    domain: GATEWAY_EIP712_DOMAIN,
    types: GATEWAY_EIP712_TYPES,
    primaryType: "BurnIntent",
    message: toTypedMessage(intent),
  };
}

/**
 * Deterministic EIP-712 digest of a burn intent. This is the 32-byte hash an
 * EOA signs; recovering it client-side or in tests does not require a signer.
 */
export function burnIntentDigest(intent: BurnIntent): `0x${string}` {
  return hashTypedData({
    domain: GATEWAY_EIP712_DOMAIN,
    types: GATEWAY_EIP712_TYPES,
    primaryType: "BurnIntent",
    message: toTypedMessage(intent),
  });
}
