/**
 * `createDcwErc8183Port` — a Circle Developer-Controlled-Wallet (DCW) adapter
 * implementing `@settlekit/erc8183`'s {@link Erc8183Port} against the **real**
 * AgenticCommerce ERC-8183 reference contract on Arc Testnet.
 *
 * Every write maps to `client.createContractExecution({ ... abiFunctionSignature,
 * abiParameters ... })` followed by `pollTransaction(...)` to a terminal
 * COMPLETE / FAILED state. There is NO chain SDK here — DCW posts
 * `abiFunctionSignature` strings + string `abiParameters`, exactly the Arc-docs
 * convention.
 *
 * Port -> contract mapping (and the lossy spots, documented loudly):
 *   - createJob       -> createJob (+ setBudget when amountUsdc > 0). jobId is
 *                        recovered by decoding the JobCreated event from the
 *                        completed receipt (config.decodeJobCreated — required).
 *   - fundEscrow      -> USDC approve(spender=contract, amount) THEN fund(jobId).
 *                        Two non-atomic DCW calls; the FUND tx hash is surfaced.
 *   - submitDeliverable -> submit(jobId, hashToBytes32(deliverableUri)).
 *   - evaluate({passed:true}) / settle -> complete(jobId, hashToBytes32(reason)).
 *                        Escrow releases on complete. evaluate({passed:false})
 *                        has NO on-chain complete path (refunds happen via the
 *                        Rejected/Expired flow, not a method here) and throws.
 *   - refund          -> NO on-chain function; throws a clear SettleKitError.
 *   - getJob          -> config.readJob (DCW has no read API) + tuple/status map.
 *
 * All failures crossing the port boundary are wrapped in a SettleKitError —
 * raw DCW/poll errors are never thrown out of this module.
 */

import {
  SettleKitError,
  notFound,
  validationError,
  type Money,
} from "@settlekit/common";
import {
  createWalletsClient,
  pollTransaction,
  type CircleBlockchain,
  type CircleFeeLevel,
  type CircleTransactionResource,
} from "@settlekit/circle-wallets";
import type { Erc8183Port, Job, TxResult } from "@settlekit/erc8183";
import {
  ABI_SIGNATURES,
  AGENTIC_COMMERCE_ADDRESS,
  DEFAULT_BLOCKCHAIN,
  EMPTY_BYTES,
  USDC_ADDRESS,
  ZERO_ADDRESS,
  jobStatusFromIndex,
} from "./contract.js";
import { jobAmountToMoney, toUsdcBaseUnitsString } from "./amount.js";
import type {
  CompletedTransaction,
  DcwErc8183Config,
  DcwPollOptions,
  DcwWalletsClient,
  OnChainJobTuple,
} from "./types.js";

/** Wrap any thrown value as a SettleKitError (pass an existing one through). */
function wrapError(error: unknown, context: string): SettleKitError {
  if (SettleKitError.is(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SettleKitError({ code: "integration_error", message: `${context}: ${message}` });
}

/** Require a non-empty string field, or throw `validation_error`. */
function requireString(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw validationError(`${field} must be a non-empty string`, { field });
  }
  return value;
}

/** Validate a decimal jobId string (uint256), or throw `validation_error`. */
function requireJobId(jobId: string): string {
  if (!/^\d+$/.test(jobId)) {
    throw validationError("jobId must be a non-negative integer string", { jobId });
  }
  return jobId;
}

/** Resolve the DCW wallets client from an injected client or build one. */
function resolveClient(config: DcwErc8183Config): DcwWalletsClient {
  if (config.client) return config.client;
  if (config.walletsClientConfig) return createWalletsClient(config.walletsClientConfig);
  throw validationError(
    "DcwErc8183Config requires either `client` or `walletsClientConfig`.",
  );
}

/** Map the on-chain tuple + status enum to an erc8183 {@link Job}. */
function mapJob(tuple: OnChainJobTuple): Job {
  const status = jobStatusFromIndex(tuple.status);
  if (status === undefined) {
    throw new SettleKitError({
      code: "integration_error",
      message: `Unknown on-chain job status index ${tuple.status}`,
      details: { jobId: tuple.id, status: tuple.status },
    });
  }
  const amount: Money = jobAmountToMoney(tuple.budget);
  // The contract tuple carries no deliverable/evaluation (deliverable/reason are
  // one-way bytes32 hashes), so those optionals are intentionally omitted.
  return {
    id: tuple.id,
    requester: tuple.client,
    worker: tuple.provider,
    amount,
    status,
  };
}

/** Build the live {@link Erc8183Port} backed by the Circle DCW path. */
export function createDcwErc8183Port(config: DcwErc8183Config): Erc8183Port {
  const client = resolveClient(config);
  const walletAddress = requireString(config.walletAddress, "config.walletAddress");
  const blockchain: CircleBlockchain = config.blockchain ?? DEFAULT_BLOCKCHAIN;
  const contractAddress = config.contractAddress ?? AGENTIC_COMMERCE_ADDRESS;
  const usdcAddress = config.usdcAddress ?? USDC_ADDRESS;
  const feeLevel: CircleFeeLevel = config.feeLevel ?? "MEDIUM";
  const hook = config.defaultHook ?? ZERO_ADDRESS;
  const evaluator = requireString(config.evaluator, "config.evaluator");
  const expiredAt = requireString(config.defaultExpiredAt, "config.defaultExpiredAt");
  const pollOpts: DcwPollOptions = config.poll ?? {};

  /**
   * Post a single contract-execution call and poll it to COMPLETE. Returns the
   * completed transaction (its `txHash` is populated). Any throw is wrapped in a
   * SettleKitError before crossing the boundary.
   */
  async function exec(
    targetContract: string,
    abiFunctionSignature: string,
    abiParameters: readonly (string | number | boolean)[],
    context: string,
  ): Promise<CircleTransactionResource> {
    try {
      const created = await client.createContractExecution({
        walletAddress,
        blockchain,
        contractAddress: targetContract,
        abiFunctionSignature,
        abiParameters,
        feeLevel,
        entitySecretCiphertext: config.entitySecretCiphertext,
      });
      return await pollTransaction(client, {
        id: created.id,
        attempts: pollOpts.attempts,
        delayMs: pollOpts.delayMs,
        sleep: pollOpts.sleep,
      });
    } catch (error) {
      throw wrapError(error, context);
    }
  }

  /** Map a completed transaction to a successful {@link TxResult}. */
  function toTxResult(tx: CircleTransactionResource): TxResult {
    return { txHash: tx.txHash ?? "", status: "success" };
  }

  function requireHash(value: string, field: string): string {
    if (!config.hashToBytes32) {
      throw validationError(
        "config.hashToBytes32 is required (the contract takes a bytes32 — inject keccak256).",
        { field },
      );
    }
    return config.hashToBytes32(value);
  }

  return {
    async createJob({ requester, worker, amountUsdc, specUri }) {
      // `requester` is informational here: the DCW signer (config.walletAddress)
      // is the on-chain client. We validate it but the contract derives client
      // from msg.sender.
      requireString(requester, "requester");
      const provider = requireString(worker, "worker");
      const description = requireString(specUri, "specUri");
      if (!config.decodeJobCreated) {
        throw validationError(
          "config.decodeJobCreated is required: DCW does not return contract " +
            "return-values, so jobId must be decoded from the JobCreated event.",
        );
      }

      const createTx = await exec(
        contractAddress,
        ABI_SIGNATURES.createJob,
        [provider, evaluator, expiredAt, description, hook],
        "createJob failed",
      );

      const completed: CompletedTransaction = { id: createTx.id, txHash: createTx.txHash };
      let decoded;
      try {
        decoded = await config.decodeJobCreated(completed);
      } catch (error) {
        throw wrapError(error, "createJob: decodeJobCreated failed");
      }
      const jobId = requireJobId(decoded.jobId);

      // Provider sets price via setBudget — only when an amount is supplied.
      const amount = toUsdcBaseUnitsString(amountUsdc);
      if (amount !== "0") {
        await exec(
          contractAddress,
          ABI_SIGNATURES.setBudget,
          [jobId, amount, EMPTY_BYTES],
          "createJob: setBudget failed",
        );
      }

      return { jobId, txHash: createTx.txHash ?? "" };
    },

    async fundEscrow({ jobId, amountUsdc }) {
      const id = requireJobId(jobId);
      const amount = toUsdcBaseUnitsString(amountUsdc);
      // 1) approve the AgenticCommerce contract to pull `amount` USDC.
      await exec(
        usdcAddress,
        ABI_SIGNATURES.approve,
        [contractAddress, amount],
        "fundEscrow: approve failed",
      );
      // 2) fund the escrow -> Funded. Surface the FUND tx hash.
      const fundTx = await exec(
        contractAddress,
        ABI_SIGNATURES.fund,
        [id, EMPTY_BYTES],
        "fundEscrow: fund failed",
      );
      return toTxResult(fundTx);
    },

    async submitDeliverable({ jobId, deliverableUri }) {
      const id = requireJobId(jobId);
      const uri = requireString(deliverableUri, "deliverableUri");
      const deliverable = requireHash(uri, "deliverableUri");
      const tx = await exec(
        contractAddress,
        ABI_SIGNATURES.submit,
        [id, deliverable, EMPTY_BYTES],
        "submitDeliverable failed",
      );
      return toTxResult(tx);
    },

    async evaluate({ jobId, passed, scoreOrUri }) {
      const id = requireJobId(jobId);
      if (!passed) {
        // The contract releases escrow only via `complete`; a failing verdict
        // has no on-chain complete path. Refunds happen through the
        // Rejected/Expired flow, which is not a method on this contract.
        throw new SettleKitError({
          code: "conflict",
          message:
            "evaluate({ passed: false }) has no on-chain effect on the AgenticCommerce " +
            "contract: escrow releases only via complete(). A failing verdict is handled " +
            "off this method via the Rejected/Expired escrow path.",
          details: { jobId: id },
        });
      }
      const reason = requireHash(scoreOrUri ?? "", "scoreOrUri");
      const tx = await exec(
        contractAddress,
        ABI_SIGNATURES.complete,
        [id, reason, EMPTY_BYTES],
        "evaluate failed",
      );
      return toTxResult(tx);
    },

    async settle({ jobId }) {
      const id = requireJobId(jobId);
      // settle == complete: escrow releases to the provider. The contract's
      // `reason` is a bytes32; with no caller-supplied reason we hash a fixed
      // marker so the bytes32 is well-formed and injected (no hand-rolled crypto).
      const reason = requireHash("settle", "settle.reason");
      const tx = await exec(
        contractAddress,
        ABI_SIGNATURES.complete,
        [id, reason, EMPTY_BYTES],
        "settle failed",
      );
      return toTxResult(tx);
    },

    async refund() {
      // The AgenticCommerce contract exposes NO refund method — the escrow
      // returns to the client only through the Rejected / Expired status paths,
      // not a callable here. Surface this loudly rather than faking a tx.
      throw new SettleKitError({
        code: "conflict",
        message:
          "refund is not supported by the AgenticCommerce ERC-8183 contract: there is no " +
          "on-chain refund function. Escrow returns to the client via the Rejected/Expired " +
          "status paths, which are not callable through this port.",
      });
    },

    async getJob({ jobId }) {
      const id = requireJobId(jobId);
      if (!config.readJob) {
        throw validationError(
          "config.readJob is required: the DCW path has no contract-read API, so getJob " +
            "needs an injected reader (a separate RPC/viem-free reader).",
        );
      }
      let tuple: OnChainJobTuple;
      try {
        tuple = await config.readJob(id);
      } catch (error) {
        if (error instanceof Error && /revert/i.test(error.message)) {
          throw notFound(`Job ${id} not found`, { jobId: id });
        }
        throw wrapError(error, "getJob: readJob failed");
      }
      return mapJob(tuple);
    },
  };
}
