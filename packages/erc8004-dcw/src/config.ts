/**
 * Configuration for the Circle Developer-Controlled-Wallet (DCW) ERC-8004 port.
 *
 * This is the "Circle Wallets" tab path: every WRITE is a
 * `createContractExecution` + `pollTransaction` round-trip against Circle W3S,
 * and every READ delegates to an injected {@link Erc8004Reader} (the DCW REST API
 * has no on-chain read). The package takes NO viem / crypto dependency, so the
 * caller MUST inject a real `keccak256` (for feedback/request hashes) and a
 * reader (for findAgentId/ownerOf/tokenUri/getValidationStatus).
 */

import { SettleKitError } from "@settlekit/common";
import type { Erc8004Registries } from "@settlekit/erc8004";
import { ARC_TESTNET_REGISTRIES } from "@settlekit/erc8004";
import type {
  CircleBlockchain,
  CircleFeeLevel,
  WalletsClient,
} from "@settlekit/circle-wallets";
import type { Erc8004Reader } from "./reader.js";
import type { Keccak256, ToHex } from "./hashing.js";

/**
 * Circle's W3S `CircleBlockchain` union does NOT (yet) include an Arc member, so
 * `blockchain: "ARC-TESTNET"` is not assignable to it. Arc's own DCW tutorials
 * use this literal, so we widen the accepted type to include it and narrowly cast
 * at the call site in {@link ./dcw-port.js}. Confirm the exact Circle W3S
 * blockchain code for Arc Testnet against Circle's enum before mainnet use.
 */
export type DcwBlockchain = CircleBlockchain | "ARC-TESTNET";

/** Default blockchain literal for the Arc Testnet DCW path. */
export const DEFAULT_DCW_BLOCKCHAIN: DcwBlockchain = "ARC-TESTNET";

/** Poll tuning forwarded to `pollTransaction`. */
export interface DcwPollOptions {
  /** Maximum number of `getTransaction` calls. */
  attempts?: number;
  /** Delay between attempts in ms. */
  delayMs?: number;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Configuration accepted by {@link createDcwErc8004Port}. */
export interface DcwErc8004Config {
  /**
   * The Circle wallets client. Only `createContractExecution` (writes) and
   * `getTransaction` (polling) are used.
   */
  client: Pick<WalletsClient, "createContractExecution" | "getTransaction">;
  /** Source developer-controlled wallet address that signs every write. */
  walletAddress: string;
  /** Blockchain literal. Defaults to {@link DEFAULT_DCW_BLOCKCHAIN}. */
  blockchain?: DcwBlockchain;
  /** ERC-8004 registry targets. Defaults to {@link ARC_TESTNET_REGISTRIES}. */
  registries?: Erc8004Registries;
  /**
   * Optional per-call entity-secret ciphertext forwarded to every write. When
   * omitted, the underlying client's `entitySecretProvider` is used.
   */
  entitySecretCiphertext?: string;
  /**
   * REQUIRED injected keccak256 (e.g. `viem.keccak256`). Used to derive the
   * feedback/request hashes; this package never hand-rolls crypto.
   */
  keccak256: Keccak256;
  /**
   * Optional UTF-8 -> 0x-hex encoder applied before `keccak256`. Defaults to a
   * trivial non-cryptographic UTF-8 encoder.
   */
  toHex?: ToHex;
  /**
   * REQUIRED injected chain reader for findAgentId/ownerOf/tokenUri/
   * getValidationStatus — the DCW REST API has no read capability.
   */
  reader: Erc8004Reader;
  /** Poll tuning forwarded to `pollTransaction`. */
  poll?: DcwPollOptions;
  /** Gas fee level for every write. Defaults to MEDIUM at the client. */
  feeLevel?: CircleFeeLevel;
  /** Explorer base for `TxResult.explorerUrl`. Defaults to the Arc explorer. */
  explorerBase?: string;
}

/**
 * A fully-resolved config with defaults applied; what the port closes over.
 */
export interface ResolvedDcwConfig {
  client: Pick<WalletsClient, "createContractExecution" | "getTransaction">;
  walletAddress: string;
  blockchain: DcwBlockchain;
  registries: Erc8004Registries;
  entitySecretCiphertext?: string;
  keccak256: Keccak256;
  toHex?: ToHex;
  reader: Erc8004Reader;
  poll?: DcwPollOptions;
  feeLevel?: CircleFeeLevel;
  explorerBase?: string;
}

/**
 * Validate config at construction, applying defaults. Throws `validation_error`
 * for any missing required field. Never mutates the input.
 */
export function resolveConfig(config: DcwErc8004Config): ResolvedDcwConfig {
  if (!config.client || typeof config.client.createContractExecution !== "function") {
    throw new SettleKitError({
      code: "validation_error",
      message: "createDcwErc8004Port requires a client with createContractExecution",
    });
  }
  if (typeof config.client.getTransaction !== "function") {
    throw new SettleKitError({
      code: "validation_error",
      message: "createDcwErc8004Port requires a client with getTransaction",
    });
  }
  if (!config.walletAddress || config.walletAddress.length === 0) {
    throw new SettleKitError({
      code: "validation_error",
      message: "createDcwErc8004Port requires a non-empty walletAddress",
    });
  }
  if (typeof config.keccak256 !== "function") {
    throw new SettleKitError({
      code: "validation_error",
      message:
        "createDcwErc8004Port requires an injected keccak256 (e.g. viem.keccak256); " +
        "this package does not hand-roll crypto",
    });
  }
  if (!config.reader || typeof config.reader.findAgentId !== "function") {
    throw new SettleKitError({
      code: "validation_error",
      message:
        "createDcwErc8004Port requires an injected reader; the DCW REST API has no " +
        "on-chain read capability (findAgentId/ownerOf/tokenUri/getValidationStatus)",
    });
  }
  return {
    client: config.client,
    walletAddress: config.walletAddress,
    blockchain: config.blockchain ?? DEFAULT_DCW_BLOCKCHAIN,
    registries: config.registries ?? ARC_TESTNET_REGISTRIES,
    entitySecretCiphertext: config.entitySecretCiphertext,
    keccak256: config.keccak256,
    toHex: config.toHex,
    reader: config.reader,
    poll: config.poll,
    feeLevel: config.feeLevel,
    explorerBase: config.explorerBase,
  };
}
