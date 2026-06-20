/**
 * `createViemErc8183Port` — the live viem adapter implementing
 * {@link Erc8183Port} against the deployed ERC-8183 job contract on Arc.
 *
 * Each write maps to `walletClient.writeContract(...)` followed by
 * `publicClient.waitForTransactionReceipt(...)`, with the receipt status mapped
 * to a {@link TxResult}. `getJob` maps the on-chain tuple to a {@link Job}.
 *
 * All viem failures are wrapped in a `SettleKitError` before crossing the port
 * boundary — raw viem errors are never thrown out of this module.
 *
 * NOTE on the ABI: the default ABI is ASSUMED (see abi.ts). Supply
 * `config.abi` with the real deployed ABI to use this without a code change.
 */

import { getAddress, isAddress } from "viem";
import type { Abi, PublicClient, WalletClient } from "viem";
import {
  SettleKitError,
  notFound,
  validationError,
  type Money,
} from "@settlekit/common";
import type { Erc8183Port, Job, JobEvaluation, JobStatus, TxResult } from "@settlekit/erc8183";
import { DEFAULT_ERC8183_ABI, JOB_STATUS_BY_INDEX } from "./abi.js";
import { jobAmountToMoney, toUsdcBaseUnits } from "./amount.js";
import { resolvePublicClient, resolveWalletClient } from "./clients.js";
import type { Hex, ViemErc8183Config } from "./types.js";

/** Shape of the assumed `getJob` on-chain return tuple. */
interface OnChainJob {
  requester: Hex;
  worker: Hex;
  amount: bigint;
  status: number;
  deliverableUri: string;
  evaluated: boolean;
  passed: boolean;
  scoreOrUri: string;
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

/** Map the on-chain tuple to an erc8183 {@link Job}, omitting empty optionals. */
function mapJob(jobId: bigint, raw: OnChainJob): Job {
  const amount: Money = jobAmountToMoney(raw.amount);
  const base: Job = {
    id: String(jobId),
    requester: getAddress(raw.requester),
    worker: getAddress(raw.worker),
    amount,
    status: statusFromIndex(raw.status),
  };
  const withDeliverable: Job =
    raw.deliverableUri.length > 0
      ? { ...base, deliverableUri: raw.deliverableUri }
      : base;
  if (!raw.evaluated) {
    return withDeliverable;
  }
  const evaluation: JobEvaluation =
    raw.scoreOrUri.length > 0
      ? { passed: raw.passed, scoreOrUri: raw.scoreOrUri }
      : { passed: raw.passed };
  return { ...withDeliverable, evaluation };
}

/**
 * Build the live {@link Erc8183Port}. Clients are resolved once (injected
 * clients are used verbatim; otherwise built from `rpcUrl`). The ABI defaults to
 * the assumed {@link DEFAULT_ERC8183_ABI}.
 */
export function createViemErc8183Port(config: ViemErc8183Config): Erc8183Port {
  const contractAddress = requireAddress(config.contractAddress, "contractAddress");
  const abi: Abi = (config.abi ?? DEFAULT_ERC8183_ABI) as Abi;
  const publicClient: PublicClient = resolvePublicClient(config);
  const walletClient: WalletClient = resolveWalletClient(config);
  const account = walletClient.account;
  if (!account) {
    throw validationError("walletClient must have an account to sign transactions.");
  }
  const chain = walletClient.chain ?? undefined;

  async function write(
    functionName: string,
    args: readonly unknown[],
    context: string,
  ): Promise<TxResult> {
    try {
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi,
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

  return {
    async createJob({ requester, worker, amountUsdc, specUri }) {
      const requesterAddr = requireAddress(requester, "requester");
      const workerAddr = requireAddress(worker, "worker");
      const amount = toUsdcBaseUnits(amountUsdc);
      const args = [requesterAddr, workerAddr, amount, specUri] as const;
      try {
        // writeContract does not return contract return-values; simulate first
        // to recover the assumed `jobId` uint256 return, then broadcast.
        // (ASSUMED createJob returns jobId — confirm against deployed contract;
        // a real contract may instead emit an event we'd decode from logs.)
        const { result } = await publicClient.simulateContract({
          address: contractAddress,
          abi,
          functionName: "createJob",
          args,
          account,
          chain,
        });
        const hash = await walletClient.writeContract({
          address: contractAddress,
          abi,
          functionName: "createJob",
          args,
          account,
          chain,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        return { jobId: String(result as bigint), txHash: hash };
      } catch (error) {
        throw wrapError(error, "createJob failed");
      }
    },

    async fundEscrow({ jobId, amountUsdc }) {
      const id = parseJobId(jobId);
      const amount = toUsdcBaseUnits(amountUsdc);
      return write("fundEscrow", [id, amount], "fundEscrow failed");
    },

    async submitDeliverable({ jobId, deliverableUri }) {
      const id = parseJobId(jobId);
      return write("submitDeliverable", [id, deliverableUri], "submitDeliverable failed");
    },

    async evaluate({ jobId, passed, scoreOrUri }) {
      const id = parseJobId(jobId);
      return write("evaluate", [id, passed, scoreOrUri ?? ""], "evaluate failed");
    },

    async settle({ jobId }) {
      const id = parseJobId(jobId);
      return write("settle", [id], "settle failed");
    },

    async refund({ jobId }) {
      const id = parseJobId(jobId);
      return write("refund", [id], "refund failed");
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
