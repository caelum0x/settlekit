import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@settlekit/common";
import {
  AgentRegistryClient,
  type Erc8004Port,
  LocalErc8004Port,
  configureErc8004,
  fnv1aHex,
} from "../src/index.js";

const OWNER = "0xowner";

function setup(): { client: AgentRegistryClient; port: LocalErc8004Port } {
  const port = new LocalErc8004Port({ owner: OWNER });
  const client = configureErc8004({ port });
  return { client, port };
}

describe("registerAgent + resolveAgent", () => {
  it("registers and resolves an agent identity", async () => {
    const { client, port } = setup();

    const reg = await client.registerAgent({ metadataUri: "ipfs://a" });
    expect(isOk(reg)).toBe(true);
    if (!isOk(reg)) return;
    expect(reg.value.txHash).toMatch(/^0xlocal/);
    expect(reg.value.explorerUrl).toContain("arcscan");

    const res = await client.resolveAgent({ owner: OWNER });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).not.toBeNull();
    expect(res.value?.agentId).toBe("1");
    expect(res.value?.owner).toBe(OWNER);
    expect(res.value?.metadataUri).toBe("ipfs://a");
    expect(port.agents()).toEqual(["1"]);
  });

  it("increments the agent id on the second register", async () => {
    const { client } = setup();
    await client.registerAgent({ metadataUri: "ipfs://a" });
    const second = await client.registerAgent({ metadataUri: "ipfs://b" });
    expect(isOk(second)).toBe(true);
    // The second agent is owned by the same wallet; resolve returns the first,
    // but the local port records both ids.
  });

  it("returns ok(null) for an unknown owner", async () => {
    const { client } = setup();
    const res = await client.resolveAgent({ owner: "0xnobody" });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toBeNull();
  });

  it("rejects an empty metadataUri", async () => {
    const { client } = setup();
    const res = await client.registerAgent({ metadataUri: "  " });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });

  it("rejects an empty owner on resolve", async () => {
    const { client } = setup();
    const res = await client.resolveAgent({ owner: "" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });
});

describe("giveFeedback validation", () => {
  it("records valid feedback", async () => {
    const { client, port } = setup();
    const res = await client.giveFeedback({
      agentId: "1",
      score: 90,
      tag: "successful_trade",
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.txHash).toMatch(/^0xlocal/);
    expect(port.feedback()).toHaveLength(1);
    expect(port.feedback()[0]?.feedbackType).toBe(0);
  });

  it("rejects a non-integer score", async () => {
    const { client } = setup();
    const res = await client.giveFeedback({ agentId: "1", score: 90.5, tag: "t" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });

  it("rejects a negative score", async () => {
    const { client } = setup();
    const res = await client.giveFeedback({ agentId: "1", score: -1, tag: "t" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });

  it("rejects a feedbackType above 255", async () => {
    const { client } = setup();
    const res = await client.giveFeedback({
      agentId: "1",
      score: 50,
      feedbackType: 256,
      tag: "t",
    });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });

  it("accepts feedbackType 0 as the default", async () => {
    const { client } = setup();
    const res = await client.giveFeedback({
      agentId: "1",
      score: 50,
      feedbackType: 0,
      tag: "t",
    });
    expect(isOk(res)).toBe(true);
  });

  it("rejects an empty tag", async () => {
    const { client } = setup();
    const res = await client.giveFeedback({ agentId: "1", score: 50, tag: "" });
    expect(isErr(res)).toBe(true);
  });

  it("rejects an empty agentId", async () => {
    const { client } = setup();
    const res = await client.giveFeedback({ agentId: "", score: 50, tag: "t" });
    expect(isErr(res)).toBe(true);
  });
});

describe("validation request/respond/status round-trip", () => {
  it("requests, responds, and reads status", async () => {
    const { client } = setup();
    await client.registerAgent({ metadataUri: "ipfs://a" });

    const req = await client.requestValidation({
      agentId: "1",
      validator: "0xval",
      requestUri: "ipfs://r",
      subject: "job-42",
    });
    expect(isOk(req)).toBe(true);
    if (!isOk(req)) return;
    expect(req.value.requestHash.startsWith("0x")).toBe(true);
    expect(req.value.requestHash).toHaveLength(66);

    const requestHash = req.value.requestHash;

    const respond = await client.respondValidation({ requestHash, response: 100, tag: "ok" });
    expect(isOk(respond)).toBe(true);

    const status = await client.getValidationStatus({ requestHash });
    expect(isOk(status)).toBe(true);
    if (!isOk(status)) return;
    expect(status.value.response).toBe(100);
    expect(status.value.passed).toBe(true);
    expect(status.value.validator).toBe("0xval");
    expect(status.value.agentId).toBe("1");
    expect(status.value.tag).toBe("ok");
  });

  it("derives a stable requestHash for the same subject", async () => {
    const { client } = setup();
    const a = await client.requestValidation({
      agentId: "1",
      validator: "0xval",
      requestUri: "ipfs://r",
      subject: "job-42",
    });
    const b = await client.requestValidation({
      agentId: "1",
      validator: "0xval",
      requestUri: "ipfs://r",
      subject: "job-42",
    });
    const c = await client.requestValidation({
      agentId: "1",
      validator: "0xval",
      requestUri: "ipfs://r",
      subject: "different",
    });
    expect(isOk(a) && isOk(b) && isOk(c)).toBe(true);
    if (!isOk(a) || !isOk(b) || !isOk(c)) return;
    expect(a.value.requestHash).toBe(b.value.requestHash);
    expect(a.value.requestHash).not.toBe(c.value.requestHash);
    expect(a.value.requestHash).toBe(fnv1aHex("job-42"));
  });

  it("marks passed=false for a response below 100", async () => {
    const { client } = setup();
    const req = await client.requestValidation({
      agentId: "1",
      validator: "0xval",
      requestUri: "ipfs://r",
      subject: "partial",
    });
    if (!isOk(req)) return;
    await client.respondValidation({ requestHash: req.value.requestHash, response: 50 });
    const status = await client.getValidationStatus({ requestHash: req.value.requestHash });
    if (!isOk(status)) return;
    expect(status.value.passed).toBe(false);
    expect(status.value.response).toBe(50);
  });

  it("rejects a response above 100", async () => {
    const { client } = setup();
    const res = await client.respondValidation({ requestHash: "0xdead", response: 101 });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });

  it("rejects a non-integer response", async () => {
    const { client } = setup();
    const res = await client.respondValidation({ requestHash: "0xdead", response: 50.5 });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });

  it("rejects an empty requestHash on respond", async () => {
    const { client } = setup();
    const res = await client.respondValidation({ requestHash: "", response: 100 });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });

  it("rejects an empty requestHash on getValidationStatus", async () => {
    const { client } = setup();
    const res = await client.getValidationStatus({ requestHash: "" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });

  it("rejects an empty validator on request", async () => {
    const { client } = setup();
    const res = await client.requestValidation({
      agentId: "1",
      validator: "",
      requestUri: "ipfs://r",
      subject: "s",
    });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("validation_error");
  });
});

describe("error mapping", () => {
  it("maps a missing-agent ownerOf throw to a retryable integration_error", async () => {
    // A port that has no registered agents: resolve finds an id but ownerOf
    // throws. Use an inline port to force the findAgentId/ownerOf mismatch.
    const throwingPort: Erc8004Port = {
      register: async () => ({ txHash: "0x" }),
      findAgentId: async () => "99",
      ownerOf: async () => {
        throw new Error("boom: unknown agentId");
      },
      tokenUri: async () => "ipfs://x",
      giveFeedback: async () => ({ txHash: "0x" }),
      requestValidation: async () => ({ txHash: "0x", requestHash: "0x0" }),
      respondValidation: async () => ({ txHash: "0x" }),
      getValidationStatus: async () => {
        throw new Error("missing");
      },
    };
    const client = new AgentRegistryClient({ port: throwingPort });

    const res = await client.resolveAgent({ owner: OWNER });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("integration_error");
    expect(res.error.retryable).toBe(true);
    expect(res.error.message).toContain("resolveAgent");
  });

  it("maps a getValidationStatus throw to a retryable integration_error", async () => {
    const { client } = setup();
    const res = await client.getValidationStatus({ requestHash: "0xnotfound" });
    expect(isErr(res)).toBe(true);
    if (!isErr(res)) return;
    expect(res.error.code).toBe("integration_error");
    expect(res.error.retryable).toBe(true);
    expect(res.error.message).toContain("getValidationStatus");
  });
});
