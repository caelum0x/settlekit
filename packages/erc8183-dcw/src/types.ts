/**
 * Configuration + injected-callback types for the Circle Developer-Controlled
 * Wallet (DCW) ERC-8183 adapter.
 *
 * Why injected callbacks: the DCW contract-execution path can only POST
 * transactions — it has **no contract-read API** and `createContractExecution`
 * does NOT return contract return-values. So three things must be supplied by
 * the consumer (typically via a separate RPC / viem-free reader OUTSIDE this
 * package), and are never silently faked:
 *
 *   - `hashToBytes32` — keccak256 of a string -> 0x-prefixed 32-byte hex, used
 *     for the contract's `bytes32` deliverable / reason arguments. Crypto is
 *     never hand-rolled here; the consumer injects the hash function.
 *   - `decodeJobCreated` — decode the `JobCreated` event from the completed
 *     `createJob` transaction's on-chain receipt to recover the `jobId`.
 *   - `readJob` — read the `getJob` tuple (DCW has no read API).
 */

import type {
  CircleBlockchain,
  CircleFeeLevel,
  WalletsClient,
  WalletsClientConfig,
} from "@settlekit/circle-wallets";

/**
 * The subset of {@link WalletsClient} this adapter uses. Accepting a `Pick`
 * keeps tests free to supply a minimal mock and documents the exact surface
 * depended upon.
 */
export type DcwWalletsClient = Pick<WalletsClient, "createContractExecution" | "getTransaction">;

/**
 * The completed transaction handle passed to {@link DcwErc8183Config.decodeJobCreated}.
 * The DCW `getTransaction` result exposes `txHash` once broadcast; the consumer
 * uses it (or the whole resource) to fetch the receipt and decode the event.
 */
export interface CompletedTransaction {
  /** Circle transaction id. */
  id: string;
  /** On-chain transaction hash, populated once the tx reaches COMPLETE. */
  txHash?: string;
}

/** The recovered identifier from a decoded `JobCreated` event. */
export interface DecodedJobCreated {
  /** The new job's id as a decimal string (uint256). */
  jobId: string;
}

/**
 * The on-chain `getJob` return tuple, verbatim from the Arc docs:
 *   tuple(uint256 id, address client, address provider, address evaluator,
 *         string description, uint256 budget, uint256 expiredAt, uint8 status,
 *         address hook)
 *
 * `budget` is the USDC base-unit amount as a decimal string; `status` is the
 * uint8 index into the on-chain Status enum (0 Open .. 5 Expired).
 */
export interface OnChainJobTuple {
  id: string;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  /** USDC 6-decimal base-unit amount as a decimal string. */
  budget: string;
  expiredAt: string;
  /** uint8 status index (0 Open, 1 Funded, 2 Submitted, 3 Completed, 4 Rejected, 5 Expired). */
  status: number;
  hook: string;
}

/** Polling knobs forwarded to `@settlekit/circle-wallets` `pollTransaction`. */
export interface DcwPollOptions {
  /** Maximum number of `getTransaction` calls. */
  attempts?: number;
  /** Delay between attempts in ms. */
  delayMs?: number;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Configuration for {@link import("./port.js").createDcwErc8183Port}.
 *
 * Supply EITHER a ready {@link DcwWalletsClient} via `client`, OR the inputs to
 * build one via `walletsClientConfig` (exactly one is required).
 */
export interface DcwErc8183Config {
  /** A ready DCW wallets client. Mutually exclusive with `walletsClientConfig`. */
  client?: DcwWalletsClient;
  /** Inputs to build a wallets client (apiKey + optional baseUrl/http/entitySecretProvider). */
  walletsClientConfig?: WalletsClientConfig;

  /** The signer developer-controlled wallet address (the client/caller). */
  walletAddress: string;

  /**
   * A fresh entity-secret ciphertext per mutating call. Circle requires a
   * UNIQUE ciphertext per request; since `createJob`/`fundEscrow` issue TWO
   * calls, a single static ciphertext will fail the second call — prefer an
   * `entitySecretProvider` on the wallets client for multi-call flows. Supplied
   * here, it is forwarded to every `createContractExecution` call.
   */
  entitySecretCiphertext?: string;

  /** Circle blockchain id. Defaults to "ARC-TESTNET". */
  blockchain?: CircleBlockchain;

  /** AgenticCommerce contract address override. Defaults to the Arc-docs address. */
  contractAddress?: string;
  /** USDC token address override. Defaults to the Arc-docs address. */
  usdcAddress?: string;

  /** Gas fee level. Defaults to "MEDIUM". */
  feeLevel?: CircleFeeLevel;

  /** Poll options forwarded to `pollTransaction`. */
  poll?: DcwPollOptions;

  /**
   * Expiry (uint256, unix seconds as a decimal string) for `createJob`. The
   * `Erc8183Port.createJob` request has no `expiredAt` field, so it MUST be
   * supplied here (no default is invented — there is no safe deterministic
   * default, and the library never calls `Date.now()`).
   */
  defaultExpiredAt: string;

  /**
   * The default `hook` address for `createJob`. Defaults to address(0) (the
   * default path).
   */
  defaultHook?: string;

  /**
   * The `evaluator` address for `createJob`. The `Erc8183Port.createJob` request
   * has no `evaluator` field (the contract's createJob takes one), so it MUST be
   * supplied here. No default is invented.
   */
  evaluator: string;

  /**
   * keccak256 of a UTF-8 string -> 0x-prefixed 32-byte hex. Used for the
   * `bytes32` deliverable / reason arguments. REQUIRED for
   * `submitDeliverable` / `evaluate` / `settle`. Crypto is never hand-rolled in
   * this package — inject e.g. viem's `keccak256(toHex(value))`.
   *
   * NOTE: hashing is one-way — the original URI / score string is NOT
   * recoverable on-chain, so `getJob` can never return a `deliverableUri`.
   */
  hashToBytes32?: (value: string) => string;

  /**
   * Decode the `JobCreated` event from the completed `createJob` transaction's
   * on-chain receipt to recover the `jobId`. REQUIRED for `createJob` (DCW does
   * not return contract return-values). The completed transaction exposes
   * `txHash` to fetch the receipt.
   */
  decodeJobCreated?: (tx: CompletedTransaction) => Promise<DecodedJobCreated>;

  /**
   * Read the `getJob` tuple for a job id. REQUIRED for `getJob` — the DCW path
   * has NO read API, so reads require a separate RPC/viem-free reader.
   */
  readJob?: (jobId: string) => Promise<OnChainJobTuple>;
}
