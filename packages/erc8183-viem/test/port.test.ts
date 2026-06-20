import { describe, expect, it, vi } from "vitest";
import { SettleKitError } from "@settlekit/common";
import type { Account, PublicClient, WalletClient } from "viem";
import { createViemErc8183Port } from "../src/port.js";
import { DEFAULT_ERC8183_ABI } from "../src/abi.js";
import type { Hex, ViemErc8183Config } from "../src/types.js";

const CONTRACT = "0x000000000000000000000000000000000000dEaD" as Hex;
const ADDR_A = "0x1111111111111111111111111111111111111111";
const ADDR_B = "0x2222222222222222222222222222222222222222";
const TX_HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as Hex;

const fakeAccount = { address: ADDR_A } as unknown as Account;

interface Fakes {
  writeContract: ReturnType<typeof vi.fn>;
  readContract: ReturnType<typeof vi.fn>;
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  simulateContract: ReturnType<typeof vi.fn>;
}

function buildConfig(opts: {
  receiptStatus?: "success" | "reverted";
  writeThrows?: Error;
  readResult?: unknown;
  readThrows?: Error;
  simulateResult?: bigint;
}): { config: ViemErc8183Config; fakes: Fakes } {
  const writeContract = vi.fn(async () => {
    if (opts.writeThrows) throw opts.writeThrows;
    return TX_HASH;
  });
  const waitForTransactionReceipt = vi.fn(async () => ({
    status: opts.receiptStatus ?? "success",
  }));
  const readContract = vi.fn(async () => {
    if (opts.readThrows) throw opts.readThrows;
    return opts.readResult;
  });
  const simulateContract = vi.fn(async () => ({ result: opts.simulateResult ?? 7n }));

  const walletClient = {
    account: fakeAccount,
    chain: { id: 4242 },
    writeContract,
  } as unknown as WalletClient;
  const publicClient = {
    waitForTransactionReceipt,
    readContract,
    simulateContract,
  } as unknown as PublicClient;

  return {
    config: { contractAddress: CONTRACT, walletClient, publicClient },
    fakes: { writeContract, readContract, waitForTransactionReceipt, simulateContract },
  };
}

describe("createViemErc8183Port — config defaulting", () => {
  it("uses injected clients verbatim and defaults the ABI", async () => {
    const { config, fakes } = buildConfig({});
    const port = createViemErc8183Port(config);
    await port.settle({ jobId: "5" });
    const call = fakes.writeContract.mock.calls[0]?.[0] as { abi: unknown };
    expect(call.abi).toBe(DEFAULT_ERC8183_ABI);
  });
});

describe("createViemErc8183Port — writes", () => {
  it("settle calls writeContract with functionName settle and BigInt jobId", async () => {
    const { config, fakes } = buildConfig({});
    const port = createViemErc8183Port(config);
    const result = await port.settle({ jobId: "5" });
    expect(result.status).toBe("success");
    expect(result.txHash).toBe(TX_HASH);
    const call = fakes.writeContract.mock.calls[0]?.[0] as {
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.functionName).toBe("settle");
    expect(call.args).toEqual([5n]);
  });

  it("maps a reverted receipt to TxResult status failed", async () => {
    const { config } = buildConfig({ receiptStatus: "reverted" });
    const port = createViemErc8183Port(config);
    const result = await port.refund({ jobId: "1" });
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

  it("createJob returns the simulated jobId and a tx hash", async () => {
    const { config } = buildConfig({ simulateResult: 42n });
    const port = createViemErc8183Port(config);
    const out = await port.createJob({
      requester: ADDR_A,
      worker: ADDR_B,
      amountUsdc: "100.00",
      specUri: "ipfs://spec",
    });
    expect(out.jobId).toBe("42");
    expect(out.txHash).toBe(TX_HASH);
  });
});

describe("createViemErc8183Port — getJob mapping", () => {
  it("maps a fully-populated tuple to a Job", async () => {
    const tuple = {
      requester: ADDR_A,
      worker: ADDR_B,
      amount: 100_000_000n,
      status: 3, // evaluated
      deliverableUri: "ipfs://deliverable",
      evaluated: true,
      passed: true,
      scoreOrUri: "0.95",
    };
    const { config } = buildConfig({ readResult: tuple });
    const port = createViemErc8183Port(config);
    const job = await port.getJob({ jobId: "9" });
    expect(job.id).toBe("9");
    expect(job.status).toBe("evaluated");
    expect(job.amount).toEqual({ amount: "100", currency: "USDC" });
    expect(job.deliverableUri).toBe("ipfs://deliverable");
    expect(job.evaluation).toEqual({ passed: true, scoreOrUri: "0.95" });
  });

  it("omits deliverableUri and evaluation when empty / not evaluated", async () => {
    const tuple = {
      requester: ADDR_A,
      worker: ADDR_B,
      amount: 0n,
      status: 0, // created
      deliverableUri: "",
      evaluated: false,
      passed: false,
      scoreOrUri: "",
    };
    const { config } = buildConfig({ readResult: tuple });
    const port = createViemErc8183Port(config);
    const job = await port.getJob({ jobId: "1" });
    expect(job.status).toBe("created");
    expect("deliverableUri" in job).toBe(false);
    expect("evaluation" in job).toBe(false);
  });

  it("omits scoreOrUri when empty but keeps the verdict", async () => {
    const tuple = {
      requester: ADDR_A,
      worker: ADDR_B,
      amount: 0n,
      status: 3,
      deliverableUri: "ipfs://d",
      evaluated: true,
      passed: false,
      scoreOrUri: "",
    };
    const { config } = buildConfig({ readResult: tuple });
    const port = createViemErc8183Port(config);
    const job = await port.getJob({ jobId: "1" });
    expect(job.evaluation).toEqual({ passed: false });
  });

  it("surfaces a reverting read as a not_found error", async () => {
    const { config } = buildConfig({ readThrows: new Error("execution reverted: no job") });
    const port = createViemErc8183Port(config);
    await expect(port.getJob({ jobId: "999" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
