import { describe, expect, it } from "vitest";
import { DEFAULT_ERC8183_ABI, JOB_STATUS_BY_INDEX } from "../src/abi.js";

type AbiFn = {
  type: string;
  name: string;
  stateMutability: string;
  inputs: readonly unknown[];
  outputs: readonly unknown[];
};

function fn(name: string): AbiFn {
  const entry = DEFAULT_ERC8183_ABI.find(
    (e) => e.type === "function" && e.name === name,
  );
  expect(entry, `ABI must contain function ${name}`).toBeTruthy();
  return entry as unknown as AbiFn;
}

const ARITY: Record<string, number> = {
  createJob: 4,
  fundEscrow: 2,
  submitDeliverable: 2,
  evaluate: 3,
  settle: 1,
  refund: 1,
  getJob: 1,
};

describe("DEFAULT_ERC8183_ABI", () => {
  it("contains every lifecycle function with correct input arity", () => {
    for (const [name, arity] of Object.entries(ARITY)) {
      expect(fn(name).inputs.length, `${name} arity`).toBe(arity);
    }
  });

  it("marks getJob as view and all others as nonpayable", () => {
    expect(fn("getJob").stateMutability).toBe("view");
    for (const name of ["createJob", "fundEscrow", "submitDeliverable", "evaluate", "settle", "refund"]) {
      expect(fn(name).stateMutability, `${name} mutability`).toBe("nonpayable");
    }
  });

  it("createJob returns a uint256 jobId", () => {
    const outputs = fn("createJob").outputs as Array<{ type: string }>;
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.type).toBe("uint256");
  });

  it("getJob returns a tuple with the mapped fields", () => {
    const outputs = fn("getJob").outputs as Array<{
      type: string;
      components?: Array<{ name: string }>;
    }>;
    expect(outputs[0]?.type).toBe("tuple");
    const names = (outputs[0]?.components ?? []).map((c) => c.name);
    expect(names).toEqual([
      "requester",
      "worker",
      "amount",
      "status",
      "deliverableUri",
      "evaluated",
      "passed",
      "scoreOrUri",
    ]);
  });
});

describe("JOB_STATUS_BY_INDEX", () => {
  it("has length 7 and covers every JobStatus member in order", () => {
    expect(JOB_STATUS_BY_INDEX).toHaveLength(7);
    expect([...JOB_STATUS_BY_INDEX]).toEqual([
      "created",
      "funded",
      "submitted",
      "evaluated",
      "settled",
      "refunded",
      "cancelled",
    ]);
  });
});
