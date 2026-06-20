import { describe, expect, it, vi } from "vitest";
import { SettleKitError } from "@settlekit/common";
import type {
  CircleTransactionResource,
  CircleTransactionState,
  CreateContractExecutionInput,
} from "@settlekit/circle-wallets";
import { createDcwErc8183Port } from "../src/port.js";
import {
  ABI_SIGNATURES,
  AGENTIC_COMMERCE_ADDRESS,
  EMPTY_BYTES,
  USDC_ADDRESS,
  ZERO_ADDRESS,
} from "../src/contract.js";
import type { DcwErc8183Config, OnChainJobTuple } from "../src/types.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const PROVIDER = "0x2222222222222222222222222222222222222222";
const EVALUATOR = "0x3333333333333333333333333333333333333333";
const REQUESTER = "0x4444444444444444444444444444444444444444";
const EXPIRED_AT = "1750000000";
const FIXED_BYTES32 =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

interface Recorder {
  calls: CreateContractExecutionInput[];
  client: DcwErc8183Config["client"];
  getTransaction: ReturnType<typeof vi.fn>;
}

/**
 * Build a recording mock DCW wallets client. Each createContractExecution call
 * is captured; getTransaction always returns a COMPLETE state with a per-id
 * txHash so pollTransaction resolves on the first poll.
 */
function buildRecorder(opts: { txState?: CircleTransactionState } = {}): Recorder {
  const calls: CreateContractExecutionInput[] = [];
  let n = 0;
  const createContractExecution = vi.fn(
    async (input: CreateContractExecutionInput): Promise<CircleTransactionResource> => {
      calls.push(input);
      n += 1;
      return {
        id: `tx_${n}`,
        blockchain: input.blockchain,
        state: "INITIATED",
        createDate: "2026-01-01T00:00:00Z",
        updateDate: "2026-01-01T00:00:00Z",
      };
    },
  );
  const getTransaction = vi.fn(
    async (id: string): Promise<CircleTransactionResource> => ({
      id,
      blockchain: "ARC-TESTNET",
      state: opts.txState ?? "COMPLETE",
      txHash: `0xhash_${id}`,
      createDate: "2026-01-01T00:00:00Z",
      updateDate: "2026-01-01T00:00:00Z",
    }),
  );
  return {
    calls,
    getTransaction,
    client: { createContractExecution, getTransaction },
  };
}

const SAMPLE_TUPLE: OnChainJobTuple = {
  id: "42",
  client: REQUESTER,
  provider: PROVIDER,
  evaluator: EVALUATOR,
  description: "ipfs://spec",
  budget: "100000000",
  expiredAt: EXPIRED_AT,
  status: 3,
  hook: ZERO_ADDRESS,
};

function buildConfig(rec: Recorder, overrides: Partial<DcwErc8183Config> = {}): DcwErc8183Config {
  return {
    client: rec.client,
    walletAddress: WALLET,
    evaluator: EVALUATOR,
    defaultExpiredAt: EXPIRED_AT,
    poll: { sleep: vi.fn(async () => {}) },
    hashToBytes32: vi.fn(() => FIXED_BYTES32),
    decodeJobCreated: vi.fn(async () => ({ jobId: "42" })),
    readJob: vi.fn(async () => SAMPLE_TUPLE),
    ...overrides,
  };
}

describe("createDcwErc8183Port — createJob", () => {
  it("posts createJob with exact signature, params, contract, blockchain, fee", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec));
    const out = await port.createJob({
      requester: REQUESTER,
      worker: PROVIDER,
      amountUsdc: "100.00",
      specUri: "ipfs://spec",
    });

    const first = rec.calls[0]!;
    expect(first.abiFunctionSignature).toBe(ABI_SIGNATURES.createJob);
    expect(first.abiFunctionSignature).toBe("createJob(address,address,uint256,string,address)");
    expect(first.abiParameters).toEqual([PROVIDER, EVALUATOR, EXPIRED_AT, "ipfs://spec", ZERO_ADDRESS]);
    expect(first.contractAddress).toBe(AGENTIC_COMMERCE_ADDRESS);
    expect(first.blockchain).toBe("ARC-TESTNET");
    expect(first.feeLevel).toBe("MEDIUM");
    expect(first.walletAddress).toBe(WALLET);

    // jobId recovered from injected decodeJobCreated.
    expect(out.jobId).toBe("42");
    expect(out.txHash).toBe("0xhash_tx_1");
  });

  it("issues a setBudget call with the USDC 6-decimal base-unit string when amount given", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec));
    await port.createJob({ requester: REQUESTER, worker: PROVIDER, amountUsdc: "100.00", specUri: "s" });

    expect(rec.calls).toHaveLength(2);
    const second = rec.calls[1]!;
    expect(second.abiFunctionSignature).toBe("setBudget(uint256,uint256,bytes)");
    expect(second.abiParameters).toEqual(["42", "100000000", EMPTY_BYTES]);
    expect(second.contractAddress).toBe(AGENTIC_COMMERCE_ADDRESS);
  });

  it("skips setBudget when amount is zero", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec));
    await port.createJob({ requester: REQUESTER, worker: PROVIDER, amountUsdc: "0", specUri: "s" });
    expect(rec.calls).toHaveLength(1);
  });

  it("throws validation_error when decodeJobCreated is not injected", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec, { decodeJobCreated: undefined }));
    await expect(
      port.createJob({ requester: REQUESTER, worker: PROVIDER, amountUsdc: "1", specUri: "s" }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });
});

describe("createDcwErc8183Port — fundEscrow", () => {
  it("issues approve on USDC THEN fund on the contract, in order", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec));
    const result = await port.fundEscrow({ jobId: "42", amountUsdc: "100.00" });

    expect(rec.calls).toHaveLength(2);
    const approve = rec.calls[0]!;
    expect(approve.abiFunctionSignature).toBe("approve(address,uint256)");
    expect(approve.contractAddress).toBe(USDC_ADDRESS);
    expect(approve.abiParameters).toEqual([AGENTIC_COMMERCE_ADDRESS, "100000000"]);

    const fund = rec.calls[1]!;
    expect(fund.abiFunctionSignature).toBe("fund(uint256,bytes)");
    expect(fund.contractAddress).toBe(AGENTIC_COMMERCE_ADDRESS);
    expect(fund.abiParameters).toEqual(["42", EMPTY_BYTES]);

    // Surfaces the FUND tx hash, not the approve hash.
    expect(result.txHash).toBe("0xhash_tx_2");
    expect(result.status).toBe("success");
  });
});

describe("createDcwErc8183Port — submit / evaluate / settle", () => {
  it("submitDeliverable posts submit with bytes32 from injected hashToBytes32", async () => {
    const rec = buildRecorder();
    const hashToBytes32 = vi.fn(() => FIXED_BYTES32);
    const port = createDcwErc8183Port(buildConfig(rec, { hashToBytes32 }));
    await port.submitDeliverable({ jobId: "42", deliverableUri: "ipfs://deliverable" });

    expect(hashToBytes32).toHaveBeenCalledWith("ipfs://deliverable");
    const call = rec.calls[0]!;
    expect(call.abiFunctionSignature).toBe("submit(uint256,bytes32,bytes)");
    expect(call.abiParameters).toEqual(["42", FIXED_BYTES32, EMPTY_BYTES]);
    expect(call.contractAddress).toBe(AGENTIC_COMMERCE_ADDRESS);
  });

  it("evaluate({passed:true}) posts complete with bytes32 reason", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec));
    await port.evaluate({ jobId: "42", passed: true, scoreOrUri: "0.95" });
    const call = rec.calls[0]!;
    expect(call.abiFunctionSignature).toBe("complete(uint256,bytes32,bytes)");
    expect(call.abiParameters).toEqual(["42", FIXED_BYTES32, EMPTY_BYTES]);
  });

  it("evaluate({passed:false}) throws a SettleKitError with no on-chain call", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec));
    await expect(port.evaluate({ jobId: "42", passed: false })).rejects.toBeInstanceOf(SettleKitError);
    expect(rec.calls).toHaveLength(0);
  });

  it("settle posts complete", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec));
    const result = await port.settle({ jobId: "42" });
    const call = rec.calls[0]!;
    expect(call.abiFunctionSignature).toBe("complete(uint256,bytes32,bytes)");
    expect(result.status).toBe("success");
  });
});

describe("createDcwErc8183Port — refund", () => {
  it("throws a SettleKitError documenting no on-chain refund function", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec));
    await expect(port.refund({ jobId: "42" })).rejects.toBeInstanceOf(SettleKitError);
    await expect(port.refund({ jobId: "42" })).rejects.toMatchObject({ code: "conflict" });
    expect(rec.calls).toHaveLength(0);
  });
});

describe("createDcwErc8183Port — getJob", () => {
  it("uses the injected readJob and maps tuple + status enum to a Job", async () => {
    const rec = buildRecorder();
    const readJob = vi.fn(async () => SAMPLE_TUPLE);
    const port = createDcwErc8183Port(buildConfig(rec, { readJob }));
    const job = await port.getJob({ jobId: "42" });

    expect(readJob).toHaveBeenCalledWith("42");
    expect(job.id).toBe("42");
    expect(job.requester).toBe(REQUESTER);
    expect(job.worker).toBe(PROVIDER);
    expect(job.status).toBe("settled"); // status index 3 -> settled
    expect(job.amount).toEqual({ amount: "100", currency: "USDC" });
  });

  it("maps each on-chain status index to the documented JobStatus", async () => {
    const cases: Array<[number, string]> = [
      [0, "created"],
      [1, "funded"],
      [2, "submitted"],
      [3, "settled"],
      [4, "refunded"],
      [5, "cancelled"],
    ];
    for (const [index, expected] of cases) {
      const rec = buildRecorder();
      const readJob = vi.fn(async () => ({ ...SAMPLE_TUPLE, status: index }));
      const port = createDcwErc8183Port(buildConfig(rec, { readJob }));
      const job = await port.getJob({ jobId: "42" });
      expect(job.status).toBe(expected);
    }
  });

  it("throws validation_error when readJob is not injected", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec, { readJob: undefined }));
    await expect(port.getJob({ jobId: "42" })).rejects.toMatchObject({ code: "validation_error" });
  });

  it("maps a reverting read to not_found", async () => {
    const rec = buildRecorder();
    const readJob = vi.fn(async () => {
      throw new Error("execution reverted: no job");
    });
    const port = createDcwErc8183Port(buildConfig(rec, { readJob }));
    await expect(port.getJob({ jobId: "999" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("createDcwErc8183Port — failure + immutability", () => {
  it("wraps a FAILED transaction state in an integration_error", async () => {
    const rec = buildRecorder({ txState: "FAILED" });
    const port = createDcwErc8183Port(buildConfig(rec));
    await expect(port.settle({ jobId: "42" })).rejects.toMatchObject({ code: "integration_error" });
  });

  it("requires either a client or walletsClientConfig", () => {
    expect(() =>
      createDcwErc8183Port({
        walletAddress: WALLET,
        evaluator: EVALUATOR,
        defaultExpiredAt: EXPIRED_AT,
      } as unknown as DcwErc8183Config),
    ).toThrow(SettleKitError);
  });

  it("validates a non-integer jobId", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec));
    await expect(port.settle({ jobId: "abc" })).rejects.toMatchObject({ code: "validation_error" });
  });

  it("submitDeliverable requires hashToBytes32", async () => {
    const rec = buildRecorder();
    const port = createDcwErc8183Port(buildConfig(rec, { hashToBytes32: undefined }));
    await expect(
      port.submitDeliverable({ jobId: "42", deliverableUri: "u" }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });
});
