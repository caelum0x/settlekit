import { describe, expect, it, vi } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { ARC_TESTNET_REGISTRIES } from "@settlekit/erc8004";
import type {
  CircleTransactionResource,
  CreateContractExecutionInput,
  WalletsClient,
} from "@settlekit/circle-wallets";
import type { ValidationStatus } from "@settlekit/erc8004";
import { createDcwErc8004Port, DCW_ABI_SIGNATURES } from "../src/index.js";
import type { Erc8004Reader } from "../src/index.js";

/** keccak256 spy: prefixes inputs so assertions are deterministic. */
const keccak256 = (hex: string): string => `0xkeccak_${hex}`;
/** toHex spy: trivial wrapper so the pre-image is visible in assertions. */
const toHex = (s: string): string => `0xhex_${s}`;

const WALLET = "0xsigner";

/** A minimal transaction resource for stubs. */
function tx(
  state: CircleTransactionResource["state"],
  extra: Partial<CircleTransactionResource> = {},
): CircleTransactionResource {
  return {
    id: "tx_1",
    blockchain: "ARC-TESTNET",
    state,
    createDate: "2026-01-01T00:00:00Z",
    updateDate: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

/**
 * Build a stub WalletsClient: createContractExecution records its input and
 * returns an INITIATED tx; getTransaction replays a scripted state queue.
 */
function stubClient(states: CircleTransactionResource[]): {
  client: Pick<WalletsClient, "createContractExecution" | "getTransaction">;
  inputs: CreateContractExecutionInput[];
  createContractExecution: ReturnType<typeof vi.fn>;
} {
  const inputs: CreateContractExecutionInput[] = [];
  const createContractExecution = vi.fn(async (input: CreateContractExecutionInput) => {
    inputs.push(input);
    return tx("INITIATED");
  });
  let i = 0;
  const getTransaction = vi.fn(async () => {
    const next = states[Math.min(i, states.length - 1)]!;
    i += 1;
    return next;
  });
  return { client: { createContractExecution, getTransaction }, inputs, createContractExecution };
}

/** A spy reader that returns scripted values. */
function spyReader(): Erc8004Reader & {
  findAgentId: ReturnType<typeof vi.fn>;
  ownerOf: ReturnType<typeof vi.fn>;
  tokenUri: ReturnType<typeof vi.fn>;
  getValidationStatus: ReturnType<typeof vi.fn>;
} {
  const status: ValidationStatus = {
    validator: "0xvalidator",
    agentId: "7",
    response: 100,
    tag: "audited",
    passed: true,
  };
  return {
    findAgentId: vi.fn(async () => "7"),
    ownerOf: vi.fn(async () => "0xowner"),
    tokenUri: vi.fn(async () => "ipfs://meta"),
    getValidationStatus: vi.fn(async () => status),
  };
}

/** A COMPLETE poll queue resolving to a fixed txHash. */
const completeStates = [tx("CONFIRMED"), tx("COMPLETE", { txHash: "0xhash" })];

const baseConfig = () => {
  const { client, inputs, createContractExecution } = stubClient(completeStates);
  const reader = spyReader();
  const port = createDcwErc8004Port({
    client,
    walletAddress: WALLET,
    keccak256,
    toHex,
    reader,
    poll: { attempts: 5, delayMs: 1, sleep: async () => {} },
  });
  return { port, inputs, createContractExecution, reader };
};

describe("createDcwErc8004Port config validation", () => {
  it("throws validation_error when keccak256 is missing", () => {
    const { client } = stubClient(completeStates);
    expect(() =>
      createDcwErc8004Port({
        client,
        walletAddress: WALLET,
        reader: spyReader(),
        // @ts-expect-error intentionally omitting keccak256
        keccak256: undefined,
      }),
    ).toThrowError(SettleKitError);
  });

  it("throws validation_error when reader is missing", () => {
    const { client } = stubClient(completeStates);
    expect(() =>
      createDcwErc8004Port({
        client,
        walletAddress: WALLET,
        keccak256,
        // @ts-expect-error intentionally omitting reader
        reader: undefined,
      }),
    ).toThrowError(SettleKitError);
  });

  it("throws validation_error on empty walletAddress", () => {
    const { client } = stubClient(completeStates);
    try {
      createDcwErc8004Port({ client, walletAddress: "", keccak256, reader: spyReader() });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SettleKitError);
      expect((err as SettleKitError).code).toBe("validation_error");
    }
  });
});

describe("register", () => {
  it("builds register(string) against the identityRegistry and returns txHash", async () => {
    const { port, inputs } = baseConfig();
    const result = await port.register({ metadataUri: "ipfs://meta" });

    expect(inputs).toHaveLength(1);
    const input = inputs[0]!;
    expect(input.contractAddress).toBe(ARC_TESTNET_REGISTRIES.identityRegistry);
    expect(input.abiFunctionSignature).toBe(DCW_ABI_SIGNATURES.register);
    expect(input.abiFunctionSignature).toBe("register(string)");
    expect(input.abiParameters).toEqual(["ipfs://meta"]);
    expect(input.walletAddress).toBe(WALLET);
    expect(input.blockchain).toBe("ARC-TESTNET");
    expect(result.txHash).toBe("0xhash");
    expect(result.explorerUrl?.endsWith("/tx/0xhash")).toBe(true);
  });
});

describe("giveFeedback", () => {
  it("builds the 8-arg signature with decimal-string scalars and feedbackHash", async () => {
    const { port, inputs } = baseConfig();
    await port.giveFeedback({
      agentId: "7",
      score: 85,
      tag: "successful_trade",
      metadataUri: "ipfs://m",
      evidenceUri: "ipfs://e",
      comment: "great",
    });

    const input = inputs[0]!;
    expect(input.contractAddress).toBe(ARC_TESTNET_REGISTRIES.reputationRegistry);
    expect(input.abiFunctionSignature).toBe(
      "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
    );
    expect(input.abiParameters).toEqual([
      "7",
      "85",
      "0",
      "successful_trade",
      "ipfs://m",
      "ipfs://e",
      "great",
      "0xkeccak_0xhex_successful_trade",
    ]);
  });

  it("defaults optional string fields to empty strings and feedbackType to 0", async () => {
    const { port, inputs } = baseConfig();
    await port.giveFeedback({ agentId: "9", score: -3, tag: "t" });
    const input = inputs[0]!;
    expect(input.abiParameters).toEqual([
      "9",
      "-3",
      "0",
      "t",
      "",
      "",
      "",
      "0xkeccak_0xhex_t",
    ]);
  });
});

describe("requestValidation", () => {
  it("builds validationRequest and returns the requestHash from keccak(toHex(subject))", async () => {
    const { port, inputs } = baseConfig();
    const result = await port.requestValidation({
      agentId: "7",
      validator: "0xval",
      requestUri: "ipfs://req",
      subject: "job-42",
    });

    const input = inputs[0]!;
    expect(input.contractAddress).toBe(ARC_TESTNET_REGISTRIES.validationRegistry);
    expect(input.abiFunctionSignature).toBe("validationRequest(address,uint256,string,bytes32)");
    expect(input.abiParameters).toEqual([
      "0xval",
      "7",
      "ipfs://req",
      "0xkeccak_0xhex_job-42",
    ]);
    expect(result.requestHash).toBe("0xkeccak_0xhex_job-42");
    expect(result.txHash).toBe("0xhash");
  });
});

describe("respondValidation", () => {
  it("builds validationResponse with requestHash + decimal-string response", async () => {
    const { port, inputs } = baseConfig();
    await port.respondValidation({
      requestHash: "0xreq",
      response: 100,
      responseUri: "ipfs://resp",
      tag: "audited",
    });

    const input = inputs[0]!;
    expect(input.contractAddress).toBe(ARC_TESTNET_REGISTRIES.validationRegistry);
    expect(input.abiFunctionSignature).toBe(
      "validationResponse(bytes32,uint8,string,bytes32,string)",
    );
    expect(input.abiParameters).toEqual([
      "0xreq",
      "100",
      "ipfs://resp",
      "0xkeccak_0xhex_audited",
      "audited",
    ]);
  });

  it("uses bytes32 zero and empty tag when no tag is supplied", async () => {
    const { port, inputs } = baseConfig();
    await port.respondValidation({ requestHash: "0xreq", response: 0 });
    const input = inputs[0]!;
    expect(input.abiParameters).toEqual([
      "0xreq",
      "0",
      "",
      `0x${"0".repeat(64)}`,
      "",
    ]);
  });
});

describe("poll outcomes", () => {
  it("rejects with integration_error when the transaction FAILS", async () => {
    const { client } = stubClient([tx("FAILED", { errorReason: "reverted" })]);
    const port = createDcwErc8004Port({
      client,
      walletAddress: WALLET,
      keccak256,
      toHex,
      reader: spyReader(),
      poll: { attempts: 3, delayMs: 1, sleep: async () => {} },
    });
    await expect(port.register({ metadataUri: "ipfs://m" })).rejects.toMatchObject({
      code: "integration_error",
    });
  });

  it("rejects when COMPLETE arrives without a txHash", async () => {
    const { client } = stubClient([tx("COMPLETE")]);
    const port = createDcwErc8004Port({
      client,
      walletAddress: WALLET,
      keccak256,
      toHex,
      reader: spyReader(),
      poll: { attempts: 3, delayMs: 1, sleep: async () => {} },
    });
    await expect(port.register({ metadataUri: "ipfs://m" })).rejects.toMatchObject({
      code: "integration_error",
    });
  });
});

describe("reads delegate to the injected reader", () => {
  it("findAgentId/ownerOf/tokenUri/getValidationStatus forward args without executing a tx", async () => {
    const { port, reader, createContractExecution } = baseConfig();

    expect(await port.findAgentId({ owner: "0xowner" })).toBe("7");
    expect(await port.ownerOf({ agentId: "7" })).toBe("0xowner");
    expect(await port.tokenUri({ agentId: "7" })).toBe("ipfs://meta");
    const status = await port.getValidationStatus({ requestHash: "0xreq" });
    expect(status.passed).toBe(true);

    expect(reader.findAgentId).toHaveBeenCalledTimes(1);
    expect(reader.findAgentId).toHaveBeenCalledWith({ owner: "0xowner" });
    expect(reader.ownerOf).toHaveBeenCalledTimes(1);
    expect(reader.ownerOf).toHaveBeenCalledWith({ agentId: "7" });
    expect(reader.tokenUri).toHaveBeenCalledTimes(1);
    expect(reader.tokenUri).toHaveBeenCalledWith({ agentId: "7" });
    expect(reader.getValidationStatus).toHaveBeenCalledTimes(1);
    expect(reader.getValidationStatus).toHaveBeenCalledWith({ requestHash: "0xreq" });

    // Reads never execute a contract transaction.
    expect(createContractExecution).not.toHaveBeenCalled();
  });
});
