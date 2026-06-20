/**
 * {@link createDcwErc8004Port} — an {@link Erc8004Port} backed by Circle's
 * Developer-Controlled-Wallet (DCW) contract-execution path (the "Circle Wallets"
 * tab).
 *
 * Each WRITE maps to `createContractExecution` (posting an `abiFunctionSignature`
 * + positional `abiParameters` exactly as Arc's docs specify — scalars as decimal
 * or hex STRINGS) followed by `pollTransaction` to a terminal `COMPLETE`/`FAILED`
 * state. Each READ delegates verbatim to the injected reader because the DCW REST
 * API cannot read chain state.
 *
 * No viem / crypto dependency: `keccak256` and the chain reader are injected.
 */

import { SettleKitError } from "@settlekit/common";
import { pollTransaction } from "@settlekit/circle-wallets";
import type { CircleBlockchain } from "@settlekit/circle-wallets";
import { explorerTxUrl } from "@settlekit/erc8004";
import type {
  Erc8004Port,
  FeedbackInput,
  TxResult,
  ValidationRequestInput,
  ValidationRequestResult,
  ValidationResponseInput,
  ValidationStatus,
} from "@settlekit/erc8004";
import type { DcwErc8004Config } from "./config.js";
import { resolveConfig } from "./config.js";
import { feedbackHash, requestHash, utf8ToHex } from "./hashing.js";

/** DCW ABI function signatures, mirrored from Arc's ERC-8004 docs. */
export const DCW_ABI_SIGNATURES = {
  register: "register(string)",
  giveFeedback: "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
  validationRequest: "validationRequest(address,uint256,string,bytes32)",
  validationResponse: "validationResponse(bytes32,uint8,string,bytes32,string)",
} as const;

/** A bytes32 zero used when an optional tag-derived hash is absent. */
const BYTES32_ZERO = `0x${"0".repeat(64)}`;

/**
 * Serialize an integer-valued number to a decimal string without scientific
 * notation, so large/negative int128/uint values survive the JSON body intact.
 */
function toIntegerString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `expected a finite integer, got ${String(value)}`,
    });
  }
  return BigInt(Math.trunc(value)).toString(10);
}

/**
 * Build an {@link Erc8004Port} that executes writes via Circle DCW contract
 * execution and delegates reads to the injected reader.
 */
export function createDcwErc8004Port(config: DcwErc8004Config): Erc8004Port {
  const resolved = resolveConfig(config);
  const toHex = resolved.toHex ?? utf8ToHex;

  /** Run one contract execution and poll it to a terminal state. */
  async function execute(
    contractAddress: string,
    abiFunctionSignature: string,
    abiParameters: readonly (string | number | boolean)[],
  ): Promise<TxResult> {
    const tx = await resolved.client.createContractExecution({
      walletAddress: resolved.walletAddress,
      // DcwBlockchain widens CircleBlockchain with "ARC-TESTNET"; cast at the
      // single boundary. See config.ts for the rationale + verification note.
      blockchain: resolved.blockchain as CircleBlockchain,
      contractAddress,
      abiFunctionSignature,
      abiParameters,
      feeLevel: resolved.feeLevel,
      entitySecretCiphertext: resolved.entitySecretCiphertext,
    });
    const completed = await pollTransaction(resolved.client, {
      id: tx.id,
      attempts: resolved.poll?.attempts,
      delayMs: resolved.poll?.delayMs,
      sleep: resolved.poll?.sleep,
    });
    if (!completed.txHash || completed.txHash.length === 0) {
      throw new SettleKitError({
        code: "integration_error",
        message: `Transaction ${tx.id} completed without a txHash`,
        details: { id: tx.id },
      });
    }
    return {
      txHash: completed.txHash,
      explorerUrl: explorerTxUrl(completed.txHash, resolved.explorerBase),
    };
  }

  return {
    async register(input: { metadataUri: string }): Promise<TxResult> {
      return execute(resolved.registries.identityRegistry, DCW_ABI_SIGNATURES.register, [
        input.metadataUri,
      ]);
    },

    async giveFeedback(input: FeedbackInput): Promise<TxResult> {
      const hash = feedbackHash(input.tag, resolved.keccak256, toHex);
      return execute(resolved.registries.reputationRegistry, DCW_ABI_SIGNATURES.giveFeedback, [
        input.agentId,
        toIntegerString(input.score),
        toIntegerString(input.feedbackType ?? 0),
        input.tag,
        input.metadataUri ?? "",
        input.evidenceUri ?? "",
        input.comment ?? "",
        hash,
      ]);
    },

    async requestValidation(input: ValidationRequestInput): Promise<ValidationRequestResult> {
      const hash = requestHash(input.subject, resolved.keccak256, toHex);
      const tx = await execute(
        resolved.registries.validationRegistry,
        DCW_ABI_SIGNATURES.validationRequest,
        [input.validator, input.agentId, input.requestUri, hash],
      );
      return { ...tx, requestHash: hash };
    },

    async respondValidation(input: ValidationResponseInput): Promise<TxResult> {
      const tagHash =
        input.tag && input.tag.length > 0
          ? feedbackHash(input.tag, resolved.keccak256, toHex)
          : BYTES32_ZERO;
      return execute(
        resolved.registries.validationRegistry,
        DCW_ABI_SIGNATURES.validationResponse,
        [input.requestHash, toIntegerString(input.response), input.responseUri ?? "", tagHash, input.tag ?? ""],
      );
    },

    async findAgentId(input: { owner: string }): Promise<string | null> {
      return resolved.reader.findAgentId(input);
    },

    async ownerOf(input: { agentId: string }): Promise<string> {
      return resolved.reader.ownerOf(input);
    },

    async tokenUri(input: { agentId: string }): Promise<string> {
      return resolved.reader.tokenUri(input);
    },

    async getValidationStatus(input: { requestHash: string }): Promise<ValidationStatus> {
      return resolved.reader.getValidationStatus(input);
    },
  };
}
