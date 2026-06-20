/**
 * The minimal ERC-8004 on-chain surface this package depends on — a *port* the
 * consumer injects (dependency inversion, mirroring app-kit's `AppKitSdk`).
 *
 * This package NEVER imports a chain library. A consumer-owned implementation
 * (backed by viem, ethers, or Circle Developer-Controlled Wallets) satisfies
 * this shape and captures its signing adapter by closure; tests and demos use
 * {@link LocalErc8004Port}. Keeping the contract here means `@settlekit/erc8004`
 * adds no external chain dependency.
 *
 * The port is intentionally NON-generic: {@link ./types.js} models all I/O with
 * concrete domain types, so there is no signing-adapter type parameter.
 *
 * Note: the port owns `requestHash` derivation. `requestValidation` hashes the
 * stable `subject` string into a bytes32-shaped handle; a real on-chain port
 * must align that hashing with the ValidationRegistry contract's scheme.
 */

import type {
  FeedbackInput,
  TxResult,
  ValidationRequestInput,
  ValidationRequestResult,
  ValidationResponseInput,
  ValidationStatus,
} from "./types.js";

/** The injected ERC-8004 registry operations. */
export interface Erc8004Port {
  /** Mint a new agent identity (ERC-721) with the given metadata URI. */
  register(input: { metadataUri: string }): Promise<TxResult>;

  /** Find the agent id owned by `owner`, or null if none is registered. */
  findAgentId(input: { owner: string }): Promise<string | null>;

  /** Resolve the owner wallet of an agent id. */
  ownerOf(input: { agentId: string }): Promise<string>;

  /** Resolve the metadata token URI of an agent id. */
  tokenUri(input: { agentId: string }): Promise<string>;

  /** Record reputation feedback about an agent. */
  giveFeedback(input: FeedbackInput): Promise<TxResult>;

  /**
   * Submit a validation request. The port computes `requestHash` from
   * `input.subject` and returns it on the result for later status lookups.
   */
  requestValidation(input: ValidationRequestInput): Promise<ValidationRequestResult>;

  /** Submit a validator's response to a prior request. */
  respondValidation(input: ValidationResponseInput): Promise<TxResult>;

  /** Read the current status of a validation request by its hash. */
  getValidationStatus(input: { requestHash: string }): Promise<ValidationStatus>;
}
