/**
 * CCTP V2 client: ties domain lookups, calldata encoding, and the Iris
 * attestation API into one cross-chain USDC transfer surface.
 *
 * The client builds signer-agnostic transaction requests (`{to, data, value}`)
 * — it never holds keys or sends transactions — and polls Iris for the
 * attestation needed to complete the mint on the destination chain.
 */

import { SettleKitError } from "@settlekit/common";
import { ARC_TESTNET } from "@settlekit/arc";
import {
  createFetchCctpHttp,
  fetchAttestation,
  IRIS_SANDBOX_BASE_URL,
  waitForAttestation,
} from "./attestation.js";
import type {
  CctpHttp,
  WaitForAttestationOptions,
} from "./attestation.js";
import { getCctpDomain } from "./domains.js";
import type { CctpChainName } from "./domains.js";
import { buildDepositForBurnTx, buildReceiveMessageTx } from "./encode.js";
import {
  FINALITY_THRESHOLD_STANDARD,
  type BuildDepositForBurnInput,
  type CctpMessage,
  type CctpTxRequest,
  type Hex,
} from "./types.js";

/** Configuration for {@link createCctpClient}. */
export interface CctpClientConfig {
  /** Inject a custom Iris transport (defaults to a real fetch-based impl). */
  http?: CctpHttp;
  /** Iris base URL (defaults to the testnet sandbox endpoint). */
  irisBaseUrl?: string;
  /** Inject a custom fetch (only used when `http` is not provided). */
  fetchImpl?: typeof fetch;
}

/**
 * High-level input for a cross-chain pay-in burn. Resolves the burn token and
 * `TokenMessengerV2` from the source chain so callers pass intent, not addresses.
 */
export interface BurnForPayInInput {
  /** Amount to burn, in USDC base units (6 decimals). */
  amount: bigint;
  /** Destination CCTP domain (e.g. Arc = 26). */
  destinationDomain: number;
  /** Recipient of the minted USDC on the destination chain. */
  mintRecipient: Hex;
  /** USDC ERC-20 address on the source chain. */
  burnToken: Hex;
  /** `TokenMessengerV2` address on the source chain. */
  tokenMessenger: Hex;
  /** Restrict who may mint on the destination, or omit for "anyone". */
  destinationCaller?: Hex;
  /** Max mint fee in USDC base units. Defaults to 0n (Standard, no fee). */
  maxFee?: bigint;
  /** Finality threshold; defaults to Standard (1000). */
  minFinalityThreshold?: number;
  /** Optional hook payload (uses `depositForBurnWithHook` when present). */
  hookData?: Hex;
}

export interface CctpClient {
  /** Resolve a chain name to its CCTP domain id. */
  domainFor(name: CctpChainName): number;
  /**
   * Build the customer's burn transaction for a cross-chain pay-in. Sign and
   * send this on the source chain; the burn emits the CCTP message.
   */
  buildBurnTx(input: BurnForPayInInput): CctpTxRequest;
  /** Fetch the current message + attestation for a burn tx, or null if not indexed. */
  fetchAttestation(srcDomain: number, txHash: Hex): Promise<CctpMessage | null>;
  /** Poll Iris until the burn's attestation is complete, then return it. */
  waitForAttestation(
    srcDomain: number,
    txHash: Hex,
    options?: WaitForAttestationOptions,
  ): Promise<CctpMessage>;
  /**
   * Build the mint (`receiveMessage`) transaction for the destination chain
   * from a completed attestation. Send this on the destination to release USDC.
   */
  buildMintTx(message: CctpMessage, messageTransmitter: Hex): CctpTxRequest;
  /**
   * Convenience for Arc-bound pay-ins: builds the mint tx against Arc testnet's
   * `MessageTransmitterV2` from a completed attestation.
   */
  buildArcMintTx(message: CctpMessage): CctpTxRequest;
}

/**
 * Create a CCTP V2 client. By default it talks to the real Iris sandbox over
 * `fetch`; pass `http` to inject an in-memory transport in tests.
 */
export function createCctpClient(config: CctpClientConfig = {}): CctpClient {
  const http =
    config.http ??
    createFetchCctpHttp({
      baseUrl: config.irisBaseUrl ?? IRIS_SANDBOX_BASE_URL,
      fetchImpl: config.fetchImpl,
    });

  return {
    domainFor(name: CctpChainName): number {
      return getCctpDomain(name);
    },

    buildBurnTx(input: BurnForPayInInput): CctpTxRequest {
      const burnInput: BuildDepositForBurnInput = {
        amount: input.amount,
        destinationDomain: input.destinationDomain,
        mintRecipient: input.mintRecipient,
        burnToken: input.burnToken,
        tokenMessenger: input.tokenMessenger,
        destinationCaller: input.destinationCaller,
        maxFee: input.maxFee ?? 0n,
        minFinalityThreshold:
          input.minFinalityThreshold ?? FINALITY_THRESHOLD_STANDARD,
        hookData: input.hookData,
      };
      return buildDepositForBurnTx(burnInput);
    },

    fetchAttestation(srcDomain: number, txHash: Hex) {
      return fetchAttestation(http, srcDomain, txHash);
    },

    waitForAttestation(
      srcDomain: number,
      txHash: Hex,
      options?: WaitForAttestationOptions,
    ) {
      return waitForAttestation(http, srcDomain, txHash, options);
    },

    buildMintTx(message: CctpMessage, messageTransmitter: Hex): CctpTxRequest {
      if (message.status !== "complete" || message.attestation === null) {
        throw new SettleKitError({
          code: "validation_error",
          message:
            "buildMintTx requires a completed attestation (status=complete with attestation present)",
          details: { status: message.status },
        });
      }
      return buildReceiveMessageTx({
        message: message.message,
        attestation: message.attestation,
        messageTransmitter,
      });
    },

    buildArcMintTx(message: CctpMessage): CctpTxRequest {
      return this.buildMintTx(
        message,
        ARC_TESTNET.contracts.cctpMessageTransmitterV2 as Hex,
      );
    },
  };
}
