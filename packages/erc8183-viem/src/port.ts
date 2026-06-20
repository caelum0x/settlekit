/**
 * `createViemErc8183Port` — the live viem adapter implementing
 * {@link Erc8183Port} against the REAL deployed AgenticCommerce (ERC-8183) job
 * contract on Arc (see abi.ts for the contract surface and addresses).
 *
 * Each write maps to `walletClient.writeContract(...)` followed by
 * `publicClient.waitForTransactionReceipt(...)`, with the receipt status mapped
 * to a {@link TxResult}. `getJob` reads the on-chain tuple and maps it to a
 * {@link Job}. All viem failures are wrapped in a `SettleKitError` before
 * crossing the port boundary — raw viem errors are never thrown out of here.
 *
 * Mapping of the fixed {@link Erc8183Port} surface onto the real contract:
 *   - createJob   -> createJob(provider, evaluator, expiredAt, description,
 *                    hook); jobId is decoded from the `JobCreated` receipt log.
 *                    When `amountUsdc > 0`, a `setBudget` follows.
 *                    (NOTE: the requester maps to the on-chain `client` =
 *                    msg.sender implicitly; the worker maps to `provider`;
 *                    specUri maps to `description`. evaluator/expiredAt/hook
 *                    come from config because the Port shape lacks them.)
 *   - fundEscrow  -> USDC approve(contract, amount) THEN fund(jobId, "0x").
 *   - submitDeliverable -> submit(jobId, keccak256(toHex(deliverableUri)), "0x").
 *   - evaluate({passed:true})  -> NO on-chain tx (verdict recorded off-chain);
 *                    the escrow release is deferred to settle(). Returns an
 *                    empty-txHash success.
 *   - evaluate({passed:false}) -> THROWS. AgenticCommerce has no reject method,
 *                    and complete() releases escrow — so a fail must never reach
 *                    complete(). Escrow for a failed job is recovered via the
 *                    job's Expired timeout, not a Port method here.
 *   - settle      -> complete(jobId, keccak256(toHex("settle")), "0x"). This is
 *                    the ONLY call that releases escrow, reached only after a
 *                    passing evaluate().
 *   - refund      -> NO direct AgenticCommerce function; throws a clear
 *                    SettleKitError. Escrow returns via the Expired job path,
 *                    not a method on this contract.
 *   - getJob      -> getJob tuple -> Job. `deliverableUri` and `evaluation`
 *                    cannot be recovered (the contract stores only bytes32
 *                    hashes, not the URI/verdict), so they are omitted.
 */

import { decodeEventLog, getAddress, isAddress, keccak256, toHex, zeroAddress } from "viem";
import type { Abi, Hash, PublicClient, WalletClient } from "viem";
import {
  SettleKitError,
  notFound,
  validationError,
  type Money,
} from "@settlekit/common";
import type { Erc8183Port, Job, JobStatus, TxResult } from "@settlekit/erc8183";
import {
  AGENTIC_COMMERCE_ABI,
  DEFAULT_AGENTIC_COMMERCE_ADDRESS,
  DEFAULT_USDC_ADDRESS,
  JOB_STATUS_BY_INDEX,
  USDC_ABI,
} from "./abi.js";
import { jobAmountToMoney, toUsdcBaseUnits } from "./amount.js";
import { resolvePublicClient, resolveWalletClient } from "./clients.js";
import type { Hex, ViemErc8183Config } from "./types.js";

/** Shape of the REAL `getJob` on-chain return tuple (9 fields). */
interface OnChainJob {
  id: bigint;
  client: Hex;
  provider: Hex;
  evaluator: Hex;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: Hex;
}

/** Minimal shape of a receipt log we need to decode the JobCreated event. */
interface ReceiptLog {
  topics: readonly Hex[];
  data: Hex;
}

/** Validate + checksum an address, or throw `validation_error`. */
function requireAddress(value: string, field: string): Hex {
  if (!isAddress(value)) {
    throw validationError(`${field} must be a 0x address`, { field, value });
  }
  return getAddress(value);
}

/** Parse a decimal jobId string into a uint256 BigInt, or throw. */
function parseJobId(jobId: string): bigint {
  if (!/^\d+$/.test(jobId)) {
    throw validationError("jobId must be a non-negative integer string", { jobId });
  }
  return BigInt(jobId);
}

/** Map an out-of-range status index defensively (noUncheckedIndexedAccess). */
function statusFromIndex(index: number): JobStatus {
  const status = JOB_STATUS_BY_INDEX[index];
  if (status === undefined) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Unknown on-chain job status index ${index}`,
    });
  }
  return status;
}

/** Wrap any thrown value as a SettleKitError (pass SettleKitError through). */
function wrapError(error: unknown, context: string): SettleKitError {
  if (SettleKitError.is(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SettleKitError({
    code: "internal_error",
    message: `${context}: ${message}`,
  });
}

/** Map a receipt status to a {@link TxResult} status. */
function receiptStatus(status: "success" | "reverted"): TxResult["status"] {
  return status === "success" ? "success" : "failed";
}

/** Deterministic bytes32 from an arbitrary string (deliverable / reason). */
function hashToBytes32(value: string): Hex {
  return keccak256(toHex(value));
}

/** Coerce the config expiry to a bigint, defaulting to 0 (no-expiry sentinel). */
function resolveExpiredAt(expiredAt: bigint | number | undefined): bigint {
  if (expiredAt === undefined) {
    return 0n;
  }
  return typeof expiredAt === "bigint" ? expiredAt : BigInt(expiredAt);
}

/**
 * Recover the new `jobId` by decoding the `JobCreated` event from the receipt
 * logs. Non-matching logs throw inside `decodeEventLog`; we skip those and
 * throw a clear SettleKitError if no JobCreated log is present.
 */
function jobIdFromReceiptLogs(logs: readonly ReceiptLog[] | undefined): bigint {
  for (const log of logs ?? []) {
    try {
      const decoded = decodeEventLog({
        abi: AGENTIC_COMMERCE_ABI,
        eventName: "JobCreated",
        topics: [...log.topics] as [Hex, ...Hex[]],
        data: log.data,
      });
      return decoded.args.jobId;
    } catch {
      // Not a JobCreated log (selector/shape mismatch) — keep scanning.
    }
  }
  throw new SettleKitError({
    code: "internal_error",
    message: "createJob: JobCreated event not found in transaction receipt",
  });
}

/** Map the REAL on-chain 9-tuple to an erc8183 {@link Job}. */
function mapJob(fallbackId: bigint, raw: OnChainJob): Job {
  const amount: Money = jobAmountToMoney(raw.budget);
  // deliverableUri / evaluation are NOT recoverable: the contract stores only
  // bytes32 hashes, not the URI or verdict — so they are intentionally omitted.
  return {
    id: String(raw.id === 0n ? fallbackId : raw.id),
    requester: getAddress(raw.client),
    worker: getAddress(raw.provider),
    amount,
    status: statusFromIndex(raw.status),
  };
}

/**
 * Build the live {@link Erc8183Port}. Clients are resolved once (injected
 * clients are used verbatim; otherwise built from `rpcUrl`). Contract/USDC
 * addresses default to the REAL deployed addresses from abi.ts.
 */
export function createViemErc8183Port(config: ViemErc8183Config): Erc8183Port {
  const contractAddress = requireAddress(
    config.contractAddress ?? DEFAULT_AGENTIC_COMMERCE_ADDRESS,
    "contractAddress",
  );
  const usdcAddress = requireAddress(
    config.usdcAddress ?? DEFAULT_USDC_ADDRESS,
    "usdcAddress",
  );
  const abi: Abi = (config.abi ?? AGENTIC_COMMERCE_ABI) as Abi;
  const usdcAbi: Abi = USDC_ABI as Abi;
  const hook: Hex = config.hook ? requireAddress(config.hook, "hook") : zeroAddress;
  const expiredAt = resolveExpiredAt(config.expiredAt);

  const publicClient: PublicClient = resolvePublicClient(config);
  const walletClient: WalletClient = resolveWalletClient(config);
  const account = walletClient.account;
  if (!account) {
    throw validationError("walletClient must have an account to sign transactions.");
  }
  const chain = walletClient.chain ?? undefined;

  /** Write to an arbitrary (address, abi) pair and await the receipt. */
  async function writeTo(
    address: Hex,
    targetAbi: Abi,
    functionName: string,
    args: readonly unknown[],
    context: string,
  ): Promise<TxResult> {
    try {
      const hash = await walletClient.writeContract({
        address,
        abi: targetAbi,
        functionName,
        args,
        account: account ?? null,
        chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { txHash: hash, status: receiptStatus(receipt.status) };
    } catch (error) {
      throw wrapError(error, context);
    }
  }

  /** Write to the AgenticCommerce contract specifically. */
  function write(
    functionName: string,
    args: readonly unknown[],
    context: string,
  ): Promise<TxResult> {
    return writeTo(contractAddress, abi, functionName, args, context);
  }

  return {
    async createJob({ requester, worker, amountUsdc, specUri }) {
      const requesterAddr = requireAddress(requester, "requester");
      const workerAddr = requireAddress(worker, "worker");
      const evaluatorAddr = config.evaluator
        ? requireAddress(config.evaluator, "evaluator")
        : requesterAddr;
      const amount = toUsdcBaseUnits(amountUsdc);
      try {
        const hash: Hash = await walletClient.writeContract({
          address: contractAddress,
          abi,
          functionName: "createJob",
          args: [workerAddr, evaluatorAddr, expiredAt, specUri, hook],
          account,
          chain,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const jobId = jobIdFromReceiptLogs(
          receipt.logs as unknown as readonly ReceiptLog[] | undefined,
        );
        // Provider sets the price via setBudget when an amount is supplied.
        if (amount > 0n) {
          await write("setBudget", [jobId, amount, "0x"], "createJob setBudget failed");
        }
        return { jobId: String(jobId), txHash: hash };
      } catch (error) {
        throw wrapError(error, "createJob failed");
      }
    },

    async fundEscrow({ jobId, amountUsdc }) {
      const id = parseJobId(jobId);
      const amount = toUsdcBaseUnits(amountUsdc);
      // 1) Client authorizes the AgenticCommerce contract to pull the escrow.
      await writeTo(
        usdcAddress,
        usdcAbi,
        "approve",
        [contractAddress, amount],
        "fundEscrow approve failed",
      );
      // 2) Client funds the job; the fund receipt is the authoritative TxResult.
      return write("fund", [id, "0x"], "fundEscrow failed");
    },

    async submitDeliverable({ jobId, deliverableUri }) {
      const id = parseJobId(jobId);
      const deliverable = hashToBytes32(deliverableUri);
      return write("submit", [id, deliverable, "0x"], "submitDeliverable failed");
    },

    async evaluate({ jobId, passed }) {
      // Validate the id even though a passing verdict sends no transaction.
      parseJobId(jobId);
      if (!passed) {
        // CRITICAL: AgenticCommerce exposes no on-chain reject. A failing
        // verdict must NEVER call complete() — complete() releases the escrow to
        // the provider, so mapping a fail to complete() would pay out for
        // rejected work. Escrow for a failed job is recovered via the job's
        // Expired timeout path, not a Port method here.
        throw new SettleKitError({
          code: "validation_error",
          message:
            "a failed evaluation cannot be settled on-chain (AgenticCommerce has no reject method) and must not release escrow; let the job expire to recover escrow",
        });
      }
      // A passing verdict is recorded off-chain by the caller's state machine.
      // The single on-chain escrow release is complete(), performed by settle()
      // — so evaluate() itself sends no transaction (avoids a double complete()).
      return { txHash: "", status: "success" as const };
    },

    async settle({ jobId }) {
      const id = parseJobId(jobId);
      // complete() releases the escrow to the provider. This is the ONLY call
      // that moves money, and it is reached only after a passing evaluate().
      const reason = hashToBytes32("settle");
      return write("complete", [id, reason, "0x"], "settle failed");
    },

    async refund() {
      // No on-chain method: escrow returns via the Rejected/Expired job paths,
      // which are not exposed as a Port method on this contract.
      throw new SettleKitError({
        code: "validation_error",
        message:
          "refund is not a direct AgenticCommerce function — escrow returns via the Rejected/Expired job paths, not a method on this contract",
      });
    },

    async getJob({ jobId }) {
      const id = parseJobId(jobId);
      let raw: OnChainJob;
      try {
        raw = (await publicClient.readContract({
          address: contractAddress,
          abi,
          functionName: "getJob",
          args: [id],
        })) as OnChainJob;
      } catch (error) {
        // A read that reverts most commonly means the job does not exist.
        if (error instanceof Error && /revert/i.test(error.message)) {
          throw notFound(`Job ${jobId} not found`, { jobId });
        }
        throw wrapError(error, "getJob failed");
      }
      return mapJob(id, raw);
    },
  };
}
