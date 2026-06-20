/**
 * Live viem implementation of `@settlekit/erc8004`'s {@link Erc8004Port} against
 * the deployed ERC-8004 registries on Arc.
 *
 * Composition: {@link resolveConfig} (defaults) + {@link resolveClients}
 * (transports/wallet) + {@link abis} (contract shapes) + {@link hashing}
 * (commitments). Writes go through the wallet client and are confirmed with
 * `waitForTransactionReceipt`; each returns an explorer URL built from
 * `@settlekit/arc-chains`.
 *
 * Network failure modes (gas/native-USDC fees, revert decoding, receipt timing)
 * only surface against a live chain — see the README for the integration caveat.
 */

import { getAddress, isAddress } from "viem";
import type { Hash } from "viem";
import { SettleKitError } from "@settlekit/common";
import { explorerTxUrl, getChain } from "@settlekit/arc-chains";
import type {
  Erc8004Port,
  FeedbackInput,
  TxResult,
  ValidationRequestInput,
  ValidationRequestResult,
  ValidationResponseInput,
  ValidationStatus,
} from "@settlekit/erc8004";
import {
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "./abis.js";
import { ZERO_BYTES32, feedbackHash, requestHash } from "./hashing.js";
import { resolveClients, requireWallet } from "./clients.js";
import { resolveConfig } from "./config.js";
import type { ViemErc8004Config } from "./config.js";

/** Response value the ValidationRegistry treats as a pass. */
const PASS_THRESHOLD = 100;

/** Cap the `findAgentId` log window to the most recent N blocks. */
const LOG_WINDOW_BLOCKS = 10_000n;

/** Validate + checksum an address, raising a `validation_error` on garbage. */
function checksum(address: string, label: string): `0x${string}` {
  if (!isAddress(address)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `${label} is not a valid address: ${address}`,
    });
  }
  return getAddress(address);
}

/** Convert a decimal/bigint-ish string to a bigint, raising on garbage. */
function toBigInt(value: string, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new SettleKitError({
      code: "validation_error",
      message: `${label} is not a valid integer: ${value}`,
    });
  }
}

/** Guard an integer score and convert to bigint (int128; negatives allowed). */
function toScore(score: number): bigint {
  if (!Number.isInteger(score)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `score must be an integer: ${score}`,
    });
  }
  return BigInt(score);
}

/** Build the canonical Arc explorer URL for a tx hash. */
function txUrl(hash: Hash): string {
  return explorerTxUrl(getChain("Arc_Testnet"), hash);
}

/**
 * Create a live viem {@link Erc8004Port}.
 *
 * Read methods work with only an RPC URL/public client; write methods require a
 * wallet (injected `walletClient` or a `privateKey` in config).
 */
export function createViemErc8004Port(
  config: ViemErc8004Config = {},
): Erc8004Port {
  const resolved = resolveConfig(config);
  const clients = resolveClients(resolved);
  const { publicClient, chain } = clients;
  const { identityRegistry, reputationRegistry, validationRegistry } =
    resolved.registries;

  const identityAddress = checksum(identityRegistry, "identityRegistry");
  const reputationAddress = checksum(reputationRegistry, "reputationRegistry");
  const validationAddress = checksum(validationRegistry, "validationRegistry");

  async function confirm(hash: Hash): Promise<TxResult> {
    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash, explorerUrl: txUrl(hash) };
  }

  return {
    async register(input: { metadataUri: string }): Promise<TxResult> {
      const { walletClient, account } = requireWallet(clients);
      const hash = await walletClient.writeContract({
        address: identityAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "register",
        args: [input.metadataUri],
        chain,
        account,
      });
      return confirm(hash);
    },

    async findAgentId(input: { owner: string }): Promise<string | null> {
      const owner = checksum(input.owner, "owner");
      const latest = await publicClient.getBlockNumber();
      const fromBlock = latest > LOG_WINDOW_BLOCKS ? latest - LOG_WINDOW_BLOCKS : 0n;
      const logs = await publicClient.getLogs({
        address: identityAddress,
        event: IDENTITY_REGISTRY_ABI[3],
        args: { to: owner },
        fromBlock,
        toBlock: "latest",
      });
      const last = logs.at(-1);
      const tokenId = last?.args.tokenId;
      return tokenId === undefined ? null : tokenId.toString();
    },

    async ownerOf(input: { agentId: string }): Promise<string> {
      const owner = await publicClient.readContract({
        address: identityAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "ownerOf",
        args: [toBigInt(input.agentId, "agentId")],
      });
      return owner;
    },

    async tokenUri(input: { agentId: string }): Promise<string> {
      const uri = await publicClient.readContract({
        address: identityAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "tokenURI",
        args: [toBigInt(input.agentId, "agentId")],
      });
      return uri;
    },

    async giveFeedback(input: FeedbackInput): Promise<TxResult> {
      const { walletClient, account } = requireWallet(clients);
      const hash = await walletClient.writeContract({
        address: reputationAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: "giveFeedback",
        args: [
          toBigInt(input.agentId, "agentId"),
          toScore(input.score),
          input.feedbackType ?? 0,
          input.tag,
          input.metadataUri ?? "",
          input.evidenceUri ?? "",
          input.comment ?? "",
          feedbackHash(input.tag),
        ],
        chain,
        account,
      });
      return confirm(hash);
    },

    async requestValidation(
      input: ValidationRequestInput,
    ): Promise<ValidationRequestResult> {
      const { walletClient, account } = requireWallet(clients);
      const validator = checksum(input.validator, "validator");
      const h = requestHash(input.subject);
      const hash = await walletClient.writeContract({
        address: validationAddress,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: "validationRequest",
        args: [validator, toBigInt(input.agentId, "agentId"), input.requestUri, h],
        chain,
        account,
      });
      const result = await confirm(hash);
      return { ...result, requestHash: h };
    },

    async respondValidation(
      input: ValidationResponseInput,
    ): Promise<TxResult> {
      const { walletClient, account } = requireWallet(clients);
      const hash = await walletClient.writeContract({
        address: validationAddress,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: "validationResponse",
        args: [
          input.requestHash as `0x${string}`,
          input.response,
          input.responseUri ?? "",
          // responseHash is not part of ValidationResponseInput; pass a zero
          // commitment. May not match real contract expectations — see README.
          ZERO_BYTES32,
          input.tag ?? "",
        ],
        chain,
        account,
      });
      return confirm(hash);
    },

    async getValidationStatus(input: {
      requestHash: string;
    }): Promise<ValidationStatus> {
      const [validatorAddress, agentId, response, , tag] =
        await publicClient.readContract({
          address: validationAddress,
          abi: VALIDATION_REGISTRY_ABI,
          functionName: "getValidationStatus",
          args: [input.requestHash as `0x${string}`],
        });
      const responseNum = Number(response);
      return {
        validator: validatorAddress,
        agentId: agentId.toString(),
        response: responseNum,
        tag,
        passed: responseNum === PASS_THRESHOLD,
      };
    },
  };
}
