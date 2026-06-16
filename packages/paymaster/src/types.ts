/**
 * TypeScript shapes for the @settlekit/paymaster package.
 *
 * Covers two complementary Circle products that let checkout/agents transact
 * without holding a native gas token:
 *
 *  1. **Gas Station** — a feature of Circle Wallets where the *developer*
 *     sponsors gas for their users according to a configured **policy**
 *     (limits on spend per tx / per day, allowed chains, etc.). Policies are
 *     managed over the Circle Web3 Services REST API.
 *
 *  2. **Circle Paymaster** — a permissionless ERC-4337 paymaster contract that
 *     lets a smart account *pay gas in USDC*. The wallet authorizes the
 *     paymaster to pull USDC via an EIP-2612 permit, encoded into the
 *     UserOperation's `paymasterData`.
 *
 * Shapes mirror Circle's published docs (https://developers.circle.com). Where
 * Circle does not publish an exact REST field (e.g. the policy resource is
 * primarily console-configured), the shape is modeled from the documented
 * console fields and the path is supplied as configuration rather than guessed.
 */

import type { ArcAddress } from "@settlekit/arc";

/** A 0x-prefixed hex string. */
export type Hex = `0x${string}`;

/** A 20-byte EVM address (alias of the Arc address type). */
export type Address = ArcAddress;

/** ERC-4337 EntryPoint versions Circle Paymaster supports. */
export type EntryPointVersion = "0.7" | "0.8";

// ---------------------------------------------------------------------------
// ERC-4337 UserOperation (v0.7 / v0.8 unpacked form)
// ---------------------------------------------------------------------------

/**
 * The unpacked ERC-4337 v0.7/v0.8 UserOperation fields, as accepted by bundler
 * RPC (`eth_sendUserOperation`, `eth_estimateUserOperationGas`). All numeric
 * gas/fee fields are `bigint`. Optional factory and paymaster fields are only
 * present when deploying an account or sponsoring gas respectively.
 */
export interface UserOperation {
  sender: Address;
  nonce: bigint;
  /** Account factory (only on the deploying UserOp). */
  factory?: Address;
  /** Calldata passed to the factory. */
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Paymaster contract address (omitted when self-paying gas). */
  paymaster?: Address;
  /** Paymaster verification phase gas limit. */
  paymasterVerificationGasLimit?: bigint;
  /** Paymaster postOp phase gas limit. */
  paymasterPostOpGasLimit?: bigint;
  /** Paymaster-specific calldata (Circle's permit-encoded blob). */
  paymasterData?: Hex;
  /** Account signature over the UserOp hash. */
  signature: Hex;
}

/**
 * Gas overrides for assembling a UserOperation. All fields optional; callers
 * typically obtain these from `eth_estimateUserOperationGas` and the chain's
 * current fee market.
 */
export interface UserOperationGas {
  callGasLimit?: bigint;
  verificationGasLimit?: bigint;
  preVerificationGas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
}

// ---------------------------------------------------------------------------
// EIP-2612 permit (used to authorize Circle Paymaster to pull USDC)
// ---------------------------------------------------------------------------

/** EIP-712 domain for an EIP-2612 permit. */
export interface PermitDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/** The EIP-2612 `Permit` message fields. */
export interface PermitMessage {
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** Fully-resolved EIP-712 typed data for an EIP-2612 permit. */
export interface PermitTypedData {
  domain: PermitDomain;
  types: { Permit: Array<{ name: string; type: string }> };
  primaryType: "Permit";
  message: PermitMessage;
}

// ---------------------------------------------------------------------------
// Gas Station policy (Circle Web3 Services REST)
// ---------------------------------------------------------------------------

/** Lifecycle status of a Gas Station sponsorship policy. */
export type GasPolicyStatus = "active" | "inactive";

/**
 * Limit rules a Gas Station policy can enforce. Mirrors the console-configurable
 * caps: maximum sponsored spend per transaction, per day, and a cap on the
 * number of sponsored operations per day. Amounts are decimal-string native gas
 * (USDC on Arc), matching how Circle surfaces spend caps.
 */
export interface GasPolicyLimits {
  /** Max sponsored native-gas spend for a single transaction (decimal string). */
  maxSpendPerTransaction?: string;
  /** Max sponsored native-gas spend per UTC day (decimal string). */
  maxSpendPerDay?: string;
  /** Max number of sponsored operations per UTC day. */
  maxOperationsPerDay?: number;
}

/** A Gas Station sponsorship policy resource. */
export interface GasPolicy {
  id: string;
  name: string;
  /** Circle blockchain identifier the policy applies to (e.g. "ARC-TESTNET"). */
  blockchain: string;
  status: GasPolicyStatus;
  limits?: GasPolicyLimits;
  /** Contract addresses sponsorship is restricted to (empty/absent = all). */
  contractAddresses?: Address[];
  createDate?: string;
  updateDate?: string;
}

/** Input to create a Gas Station policy. */
export interface CreateGasPolicyInput {
  name: string;
  blockchain: string;
  limits?: GasPolicyLimits;
  contractAddresses?: Address[];
  /** Optional idempotency key forwarded to Circle. */
  idempotencyKey?: string;
}
