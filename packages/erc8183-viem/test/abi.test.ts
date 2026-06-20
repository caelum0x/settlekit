import { describe, expect, it } from "vitest";
import {
  AGENTIC_COMMERCE_ABI,
  DEFAULT_AGENTIC_COMMERCE_ADDRESS,
  DEFAULT_ERC8183_ABI,
  DEFAULT_USDC_ADDRESS,
  ERC20_APPROVE_ABI,
  JOB_STATUS_BY_INDEX,
  USDC_ABI,
} from "../src/abi.js";

type AbiFn = {
  type: string;
  name: string;
  stateMutability: string;
  inputs: readonly { name?: string; type: string }[];
  outputs: readonly { name?: string; type: string }[];
};

function fn(abi: readonly unknown[], name: string): AbiFn {
  const entry = abi.find(
    (e) => (e as AbiFn).type === "function" && (e as AbiFn).name === name,
  );
  expect(entry, `ABI must contain function ${name}`).toBeTruthy();
  return entry as AbiFn;
}

const ARITY: Record<string, number> = {
  createJob: 5,
  setBudget: 3,
  fund: 2,
  submit: 3,
  complete: 3,
  getJob: 1,
};

describe("AGENTIC_COMMERCE_ABI (REAL deployed ABI)", () => {
  it("DEFAULT_ERC8183_ABI aliases the real AgenticCommerce ABI", () => {
    expect(DEFAULT_ERC8183_ABI).toBe(AGENTIC_COMMERCE_ABI);
  });

  it("contains every lifecycle function with correct input arity", () => {
    for (const [name, arity] of Object.entries(ARITY)) {
      expect(fn(AGENTIC_COMMERCE_ABI, name).inputs.length, `${name} arity`).toBe(arity);
    }
  });

  it("marks getJob as view and all writes as nonpayable", () => {
    expect(fn(AGENTIC_COMMERCE_ABI, "getJob").stateMutability).toBe("view");
    for (const name of ["createJob", "setBudget", "fund", "submit", "complete"]) {
      expect(fn(AGENTIC_COMMERCE_ABI, name).stateMutability, `${name} mutability`).toBe(
        "nonpayable",
      );
    }
  });

  it("createJob takes (provider, evaluator, expiredAt, description, hook) and returns uint256 jobId", () => {
    const createJob = fn(AGENTIC_COMMERCE_ABI, "createJob");
    expect(createJob.inputs.map((i) => i.type)).toEqual([
      "address",
      "address",
      "uint256",
      "string",
      "address",
    ]);
    expect(createJob.inputs[4]?.name).toBe("hook");
    expect(createJob.outputs).toHaveLength(1);
    expect(createJob.outputs[0]?.type).toBe("uint256");
    expect(createJob.outputs[0]?.name).toBe("jobId");
  });

  it("submit and complete take a bytes32 hash as their second arg", () => {
    expect(fn(AGENTIC_COMMERCE_ABI, "submit").inputs[1]?.type).toBe("bytes32");
    expect(fn(AGENTIC_COMMERCE_ABI, "complete").inputs[1]?.type).toBe("bytes32");
  });

  it("getJob returns a single 9-component tuple in the contract order", () => {
    const outputs = fn(AGENTIC_COMMERCE_ABI, "getJob").outputs as Array<{
      type: string;
      components?: Array<{ name: string }>;
    }>;
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.type).toBe("tuple");
    const names = (outputs[0]?.components ?? []).map((c) => c.name);
    expect(names).toEqual([
      "id",
      "client",
      "provider",
      "evaluator",
      "description",
      "budget",
      "expiredAt",
      "status",
      "hook",
    ]);
  });

  it("declares a JobCreated event with indexed jobId/client/provider", () => {
    const event = AGENTIC_COMMERCE_ABI.find(
      (e) => e.type === "event" && e.name === "JobCreated",
    ) as
      | { inputs: ReadonlyArray<{ name: string; type: string; indexed: boolean }> }
      | undefined;
    expect(event, "JobCreated event must exist").toBeTruthy();
    const indexed = (event?.inputs ?? []).filter((i) => i.indexed).map((i) => i.name);
    expect(indexed).toEqual(["jobId", "client", "provider"]);
  });
});

describe("USDC_ABI", () => {
  it("ERC20_APPROVE_ABI aliases USDC_ABI", () => {
    expect(ERC20_APPROVE_ABI).toBe(USDC_ABI);
  });

  it("exposes approve(address,uint256) -> bool", () => {
    const approve = fn(USDC_ABI, "approve");
    expect(approve.inputs.map((i) => i.type)).toEqual(["address", "uint256"]);
    expect(approve.stateMutability).toBe("nonpayable");
    expect(approve.outputs).toHaveLength(1);
    expect(approve.outputs[0]?.type).toBe("bool");
  });
});

describe("default addresses", () => {
  it("matches the verbatim AgenticCommerce and USDC addresses", () => {
    expect(DEFAULT_AGENTIC_COMMERCE_ADDRESS).toBe(
      "0x0747EEf0706327138c69792bF28Cd525089e4583",
    );
    expect(DEFAULT_USDC_ADDRESS).toBe("0x3600000000000000000000000000000000000000");
  });
});

describe("JOB_STATUS_BY_INDEX (on-chain enum 0..5)", () => {
  it("has length 6 and maps 0..5 to the SettleKit JobStatus union", () => {
    expect(JOB_STATUS_BY_INDEX).toHaveLength(6);
    expect([...JOB_STATUS_BY_INDEX]).toEqual([
      "created",
      "funded",
      "submitted",
      "settled",
      "refunded",
      "cancelled",
    ]);
  });
});
