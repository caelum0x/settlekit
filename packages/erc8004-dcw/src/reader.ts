/**
 * {@link Erc8004Reader} — the on-chain READ surface the Circle
 * Developer-Controlled-Wallet (DCW) path cannot provide itself.
 *
 * Circle's W3S `contractExecution` endpoint can only SEND transactions; it has
 * no JSON-RPC `eth_call` / log-query capability. Every ERC-8004 read therefore
 * needs a chain reader the consumer supplies — typically a viem/ethers reader
 * pointed at the Arc Testnet RPC. `@settlekit/erc8004-dcw` deliberately takes no
 * chain dependency, so it accepts this reader by injection rather than building
 * one.
 *
 * Resolution notes for implementers:
 *   - `findAgentId({ owner })` resolves the agent's ERC-721 token id by scanning
 *     the IdentityRegistry `Transfer(from, to, tokenId)` logs where `to === owner`
 *     (the mint), then confirming current ownership. The DCW path cannot read
 *     logs, so this MUST live in the injected reader.
 *   - `ownerOf` / `tokenUri` map to the IdentityRegistry ERC-721 `ownerOf` /
 *     `tokenURI` view calls.
 *   - `getValidationStatus({ requestHash })` maps to the ValidationRegistry
 *     `getValidationStatus(bytes32)` view call.
 */

import type { ValidationStatus } from "@settlekit/erc8004";

/**
 * The injected chain-read seam for the DCW ERC-8004 port. Each method mirrors a
 * read on {@link import("@settlekit/erc8004").Erc8004Port} verbatim; the DCW port
 * delegates to it without modification.
 */
export interface Erc8004Reader {
  /** Find the agent id owned by `owner`, or null if none is registered. */
  findAgentId(input: { owner: string }): Promise<string | null>;
  /** Resolve the owner wallet of an agent id. */
  ownerOf(input: { agentId: string }): Promise<string>;
  /** Resolve the metadata token URI of an agent id. */
  tokenUri(input: { agentId: string }): Promise<string>;
  /** Read the current status of a validation request by its hash. */
  getValidationStatus(input: { requestHash: string }): Promise<ValidationStatus>;
}
