import { describe, expect, it } from "vitest";
import {
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "../src/index.js";

/** Find an ABI function entry by name. */
function fn(abi: readonly { type: string; name?: string }[], name: string) {
  return abi.find((e) => e.type === "function" && e.name === name);
}

/** Find an ABI event entry by name. */
function ev(abi: readonly { type: string; name?: string }[], name: string) {
  return abi.find((e) => e.type === "event" && e.name === name);
}

describe("IDENTITY_REGISTRY_ABI", () => {
  it("has register/ownerOf/tokenURI functions and a Transfer event", () => {
    expect(fn(IDENTITY_REGISTRY_ABI, "register")).toBeDefined();
    expect(fn(IDENTITY_REGISTRY_ABI, "ownerOf")).toBeDefined();
    expect(fn(IDENTITY_REGISTRY_ABI, "tokenURI")).toBeDefined();
    expect(ev(IDENTITY_REGISTRY_ABI, "Transfer")).toBeDefined();
  });

  it("register takes a single string metadataURI", () => {
    const register = fn(IDENTITY_REGISTRY_ABI, "register");
    expect(register).toMatchObject({
      stateMutability: "nonpayable",
      inputs: [{ name: "metadataURI", type: "string" }],
    });
  });

  it("ownerOf returns an address for a uint256", () => {
    const ownerOf = fn(IDENTITY_REGISTRY_ABI, "ownerOf");
    expect(ownerOf).toMatchObject({
      stateMutability: "view",
      inputs: [{ type: "uint256" }],
      outputs: [{ type: "address" }],
    });
  });

  it("Transfer has three indexed inputs (from,to,tokenId)", () => {
    const transfer = ev(IDENTITY_REGISTRY_ABI, "Transfer") as {
      inputs: { name: string; type: string; indexed: boolean }[];
    };
    expect(transfer.inputs.map((i) => i.name)).toEqual([
      "from",
      "to",
      "tokenId",
    ]);
    expect(transfer.inputs.every((i) => i.indexed)).toBe(true);
  });
});

describe("REPUTATION_REGISTRY_ABI", () => {
  it("giveFeedback has 8 inputs in the documented order/types", () => {
    const give = fn(REPUTATION_REGISTRY_ABI, "giveFeedback") as {
      inputs: { name: string; type: string }[];
    };
    expect(give).toBeDefined();
    expect(give.inputs).toEqual([
      { name: "agentId", type: "uint256" },
      { name: "score", type: "int128" },
      { name: "feedbackType", type: "uint8" },
      { name: "tag", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "evidenceURI", type: "string" },
      { name: "comment", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ]);
  });
});

describe("VALIDATION_REGISTRY_ABI", () => {
  it("has validationRequest/validationResponse/getValidationStatus", () => {
    expect(fn(VALIDATION_REGISTRY_ABI, "validationRequest")).toBeDefined();
    expect(fn(VALIDATION_REGISTRY_ABI, "validationResponse")).toBeDefined();
    expect(fn(VALIDATION_REGISTRY_ABI, "getValidationStatus")).toBeDefined();
  });

  it("validationRequest takes validator/agentId/requestURI/requestHash", () => {
    const req = fn(VALIDATION_REGISTRY_ABI, "validationRequest") as {
      inputs: { name: string; type: string }[];
    };
    expect(req.inputs).toEqual([
      { name: "validator", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "requestURI", type: "string" },
      { name: "requestHash", type: "bytes32" },
    ]);
  });

  it("getValidationStatus returns the documented tuple", () => {
    const status = fn(VALIDATION_REGISTRY_ABI, "getValidationStatus") as {
      outputs: { name: string; type: string }[];
    };
    expect(status.outputs).toEqual([
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "response", type: "uint8" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
      { name: "lastUpdate", type: "uint256" },
    ]);
  });
});
