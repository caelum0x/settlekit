/**
 * Circle Paymaster orchestration — make a UserOperation pay its gas in USDC.
 *
 * Circle Paymaster is a permissionless ERC-4337 paymaster: there is no Circle
 * service RPC for sponsorship. Instead the wallet authorizes the paymaster to
 * pull USDC via an EIP-2612 permit, and that permit (plus a USDC spend cap) is
 * encoded into the UserOperation's `paymasterData`. The bundler then estimates
 * paymaster gas limits.
 *
 * This module wires the pure helpers in `userop.ts` to three injected seams so
 * it stays free of direct network/key access (and is fully testable):
 *
 *   - {@link TokenPermitReader}  — reads USDC EIP-712 name/version + owner nonce.
 *   - {@link PermitSigner}       — signs the EIP-712 permit typed data.
 *   - {@link BundlerGasEstimator} — estimates paymaster verification/postOp gas
 *                                   (optional; via bundler `eth_estimateUserOperationGas`).
 *
 * Docs: https://developers.circle.com/paymaster/pay-gas-fees-usdc
 */
import { SettleKitError } from "@settlekit/common";
import { parseErc6492Signature } from "viem";
import type { ArcChain } from "@settlekit/arc";
import {
  DEFAULT_MAX_GAS_USDC,
  ENTRYPOINT_ADDRESS,
  buildPermitTypedData,
  encodePaymasterData,
  resolvePaymasterAddress,
  withPaymaster,
} from "./userop.js";
import type {
  Address,
  EntryPointVersion,
  Hex,
  PermitTypedData,
  UserOperation,
} from "./types.js";

/** Reads the EIP-712 token metadata and owner's permit nonce from USDC. */
export interface TokenPermitReader {
  /** EIP-712 domain name of the USDC token (e.g. "USDC"). */
  tokenName(usdc: Address): Promise<string>;
  /** EIP-712 domain version of the USDC token (e.g. "2"). */
  tokenVersion(usdc: Address): Promise<string>;
  /** Current EIP-2612 nonce for `owner` on the USDC token. */
  permitNonce(usdc: Address, owner: Address): Promise<bigint>;
}

/** Signs EIP-712 typed data with the smart account owner's key. */
export interface PermitSigner {
  signTypedData(typedData: PermitTypedData): Promise<Hex>;
}

/** Estimates paymaster gas limits for a UserOperation (bundler RPC). */
export interface BundlerGasEstimator {
  estimatePaymasterGas(
    userOp: Readonly<UserOperation>,
    entryPoint: Address,
  ): Promise<{
    paymasterVerificationGasLimit: bigint;
    paymasterPostOpGasLimit: bigint;
  }>;
}

export interface SponsorWithUsdcConfig {
  chain: ArcChain;
  /** EntryPoint version (Arc Paymaster supports both; default "0.7"). */
  entryPointVersion?: EntryPointVersion;
  /** Override the resolved Circle Paymaster address (required on Arc mainnet). */
  paymasterAddress?: Address;
  /** USDC token address (defaults to the chain's native USDC). */
  usdcAddress?: Address;
  reader: TokenPermitReader;
  signer: PermitSigner;
  /** Optional bundler estimator; if absent, gas limits are left for the bundler. */
  estimator?: BundlerGasEstimator;
}

export interface SponsorWithUsdcInput {
  /** The UserOperation to make USDC-gas-paying. Must have its `sender` set. */
  userOp: Readonly<UserOperation>;
  /** Max USDC the paymaster may spend on gas (6 decimals). Default 1 USDC. */
  maxGasUsdc?: bigint;
  /** Optional permit deadline (defaults to no expiry). */
  permitDeadline?: bigint;
}

export interface SponsorWithUsdcResult {
  userOp: UserOperation;
  paymaster: Address;
  usdcAddress: Address;
  maxGasUsdc: bigint;
  permitTypedData: PermitTypedData;
}

export interface PaymasterClient {
  /**
   * Attach Circle Paymaster fields to a UserOperation so it pays gas in USDC.
   * Reads the token's permit nonce/metadata, builds + signs the EIP-2612 permit,
   * encodes `paymasterData`, optionally estimates paymaster gas, and returns a
   * new UserOperation (the input is never mutated).
   */
  sponsorWithUsdc(input: SponsorWithUsdcInput): Promise<SponsorWithUsdcResult>;
}

export function createPaymasterClient(config: SponsorWithUsdcConfig): PaymasterClient {
  const version: EntryPointVersion = config.entryPointVersion ?? "0.7";
  const usdcAddress =
    config.usdcAddress ?? (config.chain.tokens.USDC.address as Address);
  const paymaster = resolvePaymasterAddress(
    config.chain,
    version,
    config.paymasterAddress,
  );

  return {
    async sponsorWithUsdc(input: SponsorWithUsdcInput): Promise<SponsorWithUsdcResult> {
      const owner = input.userOp.sender;
      requireAddress(owner, "userOp.sender");
      const maxGasUsdc = input.maxGasUsdc ?? DEFAULT_MAX_GAS_USDC;
      if (maxGasUsdc <= 0n) {
        throw new SettleKitError({
          code: "validation_error",
          message: "maxGasUsdc must be a positive integer",
          details: { maxGasUsdc: maxGasUsdc.toString() },
        });
      }

      const [tokenName, tokenVersion, nonce] = await Promise.all([
        config.reader.tokenName(usdcAddress),
        config.reader.tokenVersion(usdcAddress),
        config.reader.permitNonce(usdcAddress, owner),
      ]);

      const permitTypedData = buildPermitTypedData({
        tokenName,
        tokenVersion,
        usdcAddress,
        chainId: config.chain.chainId,
        owner,
        spender: paymaster,
        value: maxGasUsdc,
        nonce,
        deadline: input.permitDeadline,
      });

      const wrappedSignature = await config.signer.signTypedData(permitTypedData);
      // Unwrap any ERC-6492 wrapper (undeployed-account permits) to the raw sig.
      const { signature: permitSignature } = parseErc6492Signature(wrappedSignature);

      const paymasterData = encodePaymasterData({
        usdcAddress,
        maxGasUsdc,
        permitSignature,
      });

      const base = withPaymaster(input.userOp, { paymaster, paymasterData });

      let userOp = base;
      if (config.estimator) {
        const entryPoint = ENTRYPOINT_ADDRESS[version];
        const limits = await config.estimator.estimatePaymasterGas(base, entryPoint);
        userOp = withPaymaster(input.userOp, {
          paymaster,
          paymasterData,
          paymasterVerificationGasLimit: limits.paymasterVerificationGasLimit,
          paymasterPostOpGasLimit: limits.paymasterPostOpGasLimit,
        });
      }

      return { userOp, paymaster, usdcAddress, maxGasUsdc, permitTypedData };
    },
  };
}

function requireAddress(value: string | undefined, field: string): void {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `${field} must be a 20-byte address`,
      details: { field, value },
    });
  }
}
