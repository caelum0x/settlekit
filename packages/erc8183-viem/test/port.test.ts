import { describe, expect, it, vi } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  encodeAbiParameters,
  keccak256,
  numberToHex,
  pad,
  toEventSelector,
  toHex,
  zeroAddress,
} from "viem";
import type { AbiEvent, Account, PublicClient, WalletClient } from "viem";
import { createViemErc8183Port } from "../src/port.js";
import { AGENTIC_COMMERCE_ABI, DEFAULT_USDC_ADDRESS } from "../src/abi.js";
import type { Hex, ViemErc8183Config } from "../src/types.js";

const CONTRACT = "0x000000000000000000000000000000000000dEaD" as Hex;
const ADDR_A = "0x1111111111111111111111111111111111111111";
const ADDR_B = "0x2222222222222222222222222222222222222222";
const ADDR_EVAL = "0x3333333333333333333333333333333333333333";
const TX_HASH =
  "0xabc0000000000000000000000000000000000000000000000000000000000001" as Hex;

const fakeAccount = { address: ADDR_A } as unknown as Account;

const JOB_CREATED = AGENTIC_COMMERCE_ABI.find(
  (e): e is Extract<(typeof AGENTIC_COMMERCE_ABI)[number], { type: "event" }> =>
    e.type === "event" && e.name === "JobCreated",
) as unknown as AbiEvent;

/** Build a real, decodable JobCreated receipt log for `jobId`. */
function jobCreatedLog(jobId: bigint): { topics: Hex[]; data: Hex } {
  const selector = toEventSelector(JOB_CREATED);
  const topics: Hex[] = [
    selector,
    pad(numberToHex(jobId)),
    pad(ADDR_A as Hex),
    pad(ADDR_B as Hex),
  ];
  const data = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "address" }],
    [ADDR_EVAL as Hex, 1_700_000_000n, zeroAddress],
  );
  return { topics, data };
}

interface Fakes {
  writeContract: ReturnType<typeof vi.fn>;
  readContract: ReturnType<typeof vi.fn>;
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
}

function buildConfig(opts: {
  receiptStatus?: "success" | "reverted";
  writeThrows?: Error;
  readResult?: unknown;
  readThrows?: Error;
  createdJobId?: bigint;
  noJobCreatedLog?: boolean;
  config?: Partial<ViemErc8183Config>;
}): { config: ViemErc8183Config; fakes: Fakes } {
  const writeContract = vi.fn(async () => {
    if (opts.writeThrows) throw opts.writeThrows;
    return TX_HASH;
  });
  const waitForTransactionReceipt = vi.fn(async () => ({
    status: opts.receiptStatus ?? "success",
    logs: opts.noJobCreatedLog
      ? []
      : [jobCreatedLog(opts.createdJobId ?? 7n)],
  }));
  const readContract = vi.fn(async () => {
    if (opts.readThrows) throw opts.readThrows;
    return opts.readResult;
  });

  const walletClient = {
    account: fakeAccount,
    chain: { id: 4242 },
    writeContract,
  } as unknown as WalletClient;
  const publicClient = {
    waitForTransactionReceipt,
    readContract,
  } as unknown as PublicClient;

  return {
    config: {
      contractAddress: CONTRACT,
      walletClient,
      publicClient,
      ...opts.config,
    },
    fakes: { writeContract, readContract, waitForTransactionReceipt },
  };
}

function tuple(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 0n,
    client: ADDR_A,
    provider: ADDR_B,
    evaluator: ADDR_EVAL,
    description: "ipfs://spec",
    budget: 0n,
    expiredAt: 0n,
    status: 0,
    hook: zeroAddress,
    ...overrides,
  };
}

describe("createViemErc8183Port — config defaulting", () => {
  it("uses injected clients verbatim and defaults the ABI", async () => {
    const { config, fakes } = buildConfig({});
    const port = createViemErc8183Port(config);
    await port.settle({ jobId: "5" });
    const call = fakes.writeContract.mock.calls[0]?.[0] as { abi: unknown };
    expect(call.abi).toBe(AGENTIC_COMMERCE_ABI);
  });
});

describe("createViemErc8183Port — createJob", () => {
  it("decodes jobId from the JobCreated receipt log and calls setBudget when funded", async () => {
    const { config, fakes } = buildConfig({ createdJobId: 42n });
    const port = createViemErc8183Port(config);
    const out = await port.createJob({
      requester: ADDR_A,
      worker: ADDR_B,
      amountUsdc: "100.00",
      specUri: "ipfs://spec",
    });
    expect(out.jobId).toBe("42");
    expect(out.txHash).toBe(TX_HASH);

    const first = fakes.writeContract.mock.calls[0]?.[0] as {
      functionName: string;
      args: readonly unknown[];
    };
    expect(first.functionName).toBe("createJob");
    // (provider, evaluator, expiredAt, description, hook); evaluator defaults to requester
    expect(first.args[0]).toBe(ADDR_B);
    expect(first.args[1]).toBe(ADDR_A);
    expect(first.args[3]).toBe("ipfs://spec");
    expect(first.args[4]).toBe(zeroAddress);

    const second = fakes.writeContract.mock.calls[1]?.[0] as {
      functionName: string;
      args: readonly unknown[];
    };
    expect(second.functionName).toBe("setBudget");
    expect(second.args).toEqual([42n, 100_000_000n, "0x"]);
  });

  it("skips setBudget when amount is zero", async () => {
    const { config, fakes } = buildConfig({ createdJobId: 9n });
    const port = createViemErc8183Port(config);
    const out = await port.createJob({
      requester: ADDR_A,
      worker: ADDR_B,
      amountUsdc: "0",
      specUri: "ipfs://spec",
    });
    expect(out.jobId).toBe("9");
    expect(fakes.writeContract).toHaveBeenCalledTimes(1);
  });

  it("uses the configured evaluator/hook/expiredAt when supplied", async () => {
    const { config, fakes } = buildConfig({
      createdJobId: 1n,
      config: { evaluator: ADDR_EVAL as Hex, hook: CONTRACT, expiredAt: 1234n },
    });
    const port = createViemErc8183Port(config);
    await port.createJob({
      requester: ADDR_A,
      worker: ADDR_B,
      amountUsdc: "0",
      specUri: "ipfs://spec",
    });
    const first = fakes.writeContract.mock.calls[0]?.[0] as { args: readonly unknown[] };
    expect(first.args[1]).toBe(ADDR_EVAL);
    expect(first.args[2]).toBe(1234n);
    expect(first.args[4]).toBe(CONTRACT);
  });

  it("throws when the receipt has no JobCreated log", async () => {
    const { config } = buildConfig({ noJobCreatedLog: true });
    const port = createViemErc8183Port(config);
    await expect(
      port.createJob({
        requester: ADDR_A,
        worker: ADDR_B,
        amountUsdc: "0",
        specUri: "ipfs://spec",
      }),
    ).rejects.toBeInstanceOf(SettleKitError);
  });
});

describe("createViemErc8183Port — fundEscrow", () => {
  it("approves USDC for the contract THEN funds the job", async () => {
    const { config, fakes } = buildConfig({});
    const port = createViemErc8183Port(config);
    const result = await port.fundEscrow({ jobId: "5", amountUsdc: "100.00" });
    expect(result.status).toBe("success");

    const approve = fakes.writeContract.mock.calls[0]?.[0] as {
      address: string;
      functionName: string;
      args: readonly unknown[];
    };
    expect(approve.address).toBe(DEFAULT_USDC_ADDRESS);
    expect(approve.functionName).toBe("approve");
    expect(approve.args).toEqual([CONTRACT, 100_000_000n]);

    const fund = fakes.writeContract.mock.calls[1]?.[0] as {
      address: string;
      functionName: string;
      args: readonly unknown[];
    };
    expect(fund.address).toBe(CONTRACT);
    expect(fund.functionName).toBe("fund");
    expect(fund.args).toEqual([5n, "0x"]);
  });
});

describe("createViemErc8183Port — submit / evaluate / settle", () => {
  it("submitDeliverable hashes the URI to bytes32 deterministically", async () => {
    const { config, fakes } = buildConfig({});
    const port = createViemErc8183Port(config);
    await port.submitDeliverable({ jobId: "5", deliverableUri: "ipfs://x" });
    const call = fakes.writeContract.mock.calls[0]?.[0] as {
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.functionName).toBe("submit");
    expect(call.args[0]).toBe(5n);
    expect(call.args[1]).toBe(keccak256(toHex("ipfs://x")));
    expect(call.args[2]).toBe("0x");
    // determinism: same input => same hash, different input => different hash
    expect(keccak256(toHex("ipfs://x"))).toBe(keccak256(toHex("ipfs://x")));
    expect(keccak256(toHex("ipfs://x"))).not.toBe(keccak256(toHex("ipfs://y")));
  });

  it("evaluate maps to complete() with a bytes32 reason", async () => {
    const { config, fakes } = buildConfig({});
    const port = createViemErc8183Port(config);
    await port.evaluate({ jobId: "5", passed: true, scoreOrUri: "0.95" });
    const call = fakes.writeContract.mock.calls[0]?.[0] as {
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.functionName).toBe("complete");
    expect(call.args[0]).toBe(5n);
    expect(call.args[1]).toBe(keccak256(toHex("0.95")));
  });

  it("settle maps to complete() with a bytes32 reason", async () => {
    const { config, fakes } = buildConfig({});
    const port = createViemErc8183Port(config);
    const result = await port.settle({ jobId: "5" });
    expect(result.status).toBe("success");
    expect(result.txHash).toBe(TX_HASH);
    const call = fakes.writeContract.mock.calls[0]?.[0] as {
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.functionName).toBe("complete");
    expect(call.args[0]).toBe(5n);
    expect(call.args[1]).toBe(keccak256(toHex("settle")));
  });

  it("maps a reverted receipt to TxResult status failed", async () => {
    const { config } = buildConfig({ receiptStatus: "reverted" });
    const port = createViemErc8183Port(config);
    const result = await port.settle({ jobId: "1" });
    expect(result.status).toBe("failed");
  });

  it("wraps a writeContract throw in a SettleKitError", async () => {
    const { config } = buildConfig({ writeThrows: new Error("execution reverted") });
    const port = createViemErc8183Port(config);
    await expect(port.settle({ jobId: "1" })).rejects.toBeInstanceOf(SettleKitError);
  });

  it("rejects a non-integer jobId with a validation_error", async () => {
    const { config } = buildConfig({});
    const port = createViemErc8183Port(config);
    await expect(port.settle({ jobId: "abc" })).rejects.toMatchObject({
      code: "validation_error",
    });
  });
});

describe("createViemErc8183Port — refund", () => {
  it("throws a SettleKitError and never calls writeContract", async () => {
    const { config, fakes } = buildConfig({});
    const port = createViemErc8183Port(config);
    await expect(port.refund({ jobId: "1" })).rejects.toBeInstanceOf(SettleKitError);
    expect(fakes.writeContract).not.toHaveBeenCalled();
  });
});

describe("createViemErc8183Port — getJob mapping", () => {
  it("maps the 9-tuple to a Job (requester=client, worker=provider)", async () => {
    const { config } = buildConfig({
      readResult: tuple({ id: 9n, budget: 100_000_000n, status: 3 }),
    });
    const port = createViemErc8183Port(config);
    const job = await port.getJob({ jobId: "9" });
    expect(job.id).toBe("9");
    expect(job.requester).toBe(ADDR_A);
    expect(job.worker).toBe(ADDR_B);
    expect(job.amount).toEqual({ amount: "100", currency: "USDC" });
    expect(job.status).toBe("settled");
    // deliverableUri / evaluation are not recoverable from the real tuple.
    expect("deliverableUri" in job).toBe(false);
    expect("evaluation" in job).toBe(false);
  });

  it("maps every on-chain status enum 0..5", async () => {
    const expected = ["created", "funded", "submitted", "settled", "refunded", "cancelled"];
    for (let status = 0; status < expected.length; status++) {
      const { config } = buildConfig({ readResult: tuple({ id: 1n, status }) });
      const port = createViemErc8183Port(config);
      const job = await port.getJob({ jobId: "1" });
      expect(job.status).toBe(expected[status]);
    }
  });

  it("falls back to the requested jobId when tuple id is 0", async () => {
    const { config } = buildConfig({ readResult: tuple({ id: 0n }) });
    const port = createViemErc8183Port(config);
    const job = await port.getJob({ jobId: "7" });
    expect(job.id).toBe("7");
  });

  it("throws validation_error for an out-of-range status index", async () => {
    const { config } = buildConfig({ readResult: tuple({ id: 1n, status: 99 }) });
    const port = createViemErc8183Port(config);
    await expect(port.getJob({ jobId: "1" })).rejects.toMatchObject({
      code: "validation_error",
    });
  });

  it("surfaces a reverting read as a not_found error", async () => {
    const { config } = buildConfig({
      readThrows: new Error("execution reverted: no job"),
    });
    const port = createViemErc8183Port(config);
    await expect(port.getJob({ jobId: "999" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
