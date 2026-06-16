import { describe, expect, it } from "vitest";
import { money } from "@settlekit/common";
import { createArcClient } from "../src/arc-client.js";
import { TRANSFER_EVENT_TOPIC } from "../src/usdc-abi.js";
import type { ArcRpc } from "../src/rpc.js";
import type { ArcTransactionReceipt, Hex } from "../src/types.js";

const USDC: Hex = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const FROM: Hex = "0x1111111111111111111111111111111111111111";
const TO: Hex = "0x2222222222222222222222222222222222222222";
const TX: Hex = "0xdeadbeef";

function addressTopic(address: Hex): Hex {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex;
}

function uint256(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

/**
 * An in-memory implementation of the real ArcRpc interface that returns a
 * canned receipt + head block. This is a real test double of OUR interface;
 * it drives the genuine decoding/confirmation logic.
 */
function inMemoryRpc(args: {
  receipt: ArcTransactionReceipt | null;
  head: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}): ArcRpc {
  return {
    async getTransactionReceipt(txHash: Hex) {
      if (args.receipt === null) return null;
      return txHash === args.receipt.transactionHash ? args.receipt : null;
    },
    async getBlockNumber() {
      return args.head;
    },
    async estimateFeesPerGas() {
      return {
        maxFeePerGas: args.maxFeePerGas ?? 1_000_000_000n,
        maxPriorityFeePerGas: args.maxPriorityFeePerGas ?? 100_000_000n,
      };
    },
  };
}

function receiptWithTransfer(value: bigint, status: ArcTransactionReceipt["status"] = "success"): ArcTransactionReceipt {
  return {
    transactionHash: TX,
    blockNumber: 100n,
    status,
    from: FROM,
    to: USDC,
    logs: [
      {
        address: USDC,
        topics: [TRANSFER_EVENT_TOPIC, addressTopic(FROM), addressTopic(TO)],
        data: uint256(value),
        logIndex: 0,
      },
    ],
  };
}

describe("createArcClient.verifyUsdcTransfer", () => {
  it("confirms a transfer >= minAmount to the expected recipient", async () => {
    const rpc = inMemoryRpc({ receipt: receiptWithTransfer(25_500_000n), head: 105n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 1 },
      rpc,
    );

    const result = await client.verifyUsdcTransfer({
      txHash: TX,
      to: TO,
      minAmount: money("25"),
    });

    expect(result.confirmed).toBe(true);
    expect(result.from).toBe(FROM.toLowerCase());
    expect(result.amount).toEqual(money("25.5"));
    // head 105, block 100 => 6 confirmations inclusive of mining block
    expect(result.confirmations).toBe(6);
  });

  it("rejects when the transfer amount is below minAmount", async () => {
    const rpc = inMemoryRpc({ receipt: receiptWithTransfer(1_000_000n), head: 100n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 1 },
      rpc,
    );

    const result = await client.verifyUsdcTransfer({
      txHash: TX,
      to: TO,
      minAmount: money("25"),
    });

    expect(result.confirmed).toBe(false);
    expect(result.from).toBeNull();
    expect(result.amount).toBeNull();
    expect(result.confirmations).toBe(1);
  });

  it("rejects a transfer to a different recipient", async () => {
    const rpc = inMemoryRpc({ receipt: receiptWithTransfer(50_000_000n), head: 100n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 1 },
      rpc,
    );

    const other: Hex = "0x3333333333333333333333333333333333333333";
    const result = await client.verifyUsdcTransfer({
      txHash: TX,
      to: other,
      minAmount: money("1"),
    });

    expect(result.confirmed).toBe(false);
  });

  it("rejects a reverted transaction", async () => {
    const rpc = inMemoryRpc({ receipt: receiptWithTransfer(50_000_000n, "reverted"), head: 100n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 1 },
      rpc,
    );

    const result = await client.verifyUsdcTransfer({
      txHash: TX,
      to: TO,
      minAmount: money("1"),
    });

    expect(result.confirmed).toBe(false);
    expect(result.confirmations).toBe(0);
  });

  it("returns unconfirmed when the receipt is not found", async () => {
    const rpc = inMemoryRpc({ receipt: null, head: 100n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 1 },
      rpc,
    );

    const result = await client.verifyUsdcTransfer({
      txHash: TX,
      to: TO,
      minAmount: money("1"),
    });

    expect(result.confirmed).toBe(false);
    expect(result.confirmations).toBe(0);
  });
});

const EURC: Hex = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

function receiptWithTokenTransfer(token: Hex, value: bigint): ArcTransactionReceipt {
  return {
    transactionHash: TX,
    blockNumber: 100n,
    status: "success",
    from: FROM,
    to: token,
    logs: [
      {
        address: token,
        topics: [TRANSFER_EVENT_TOPIC, addressTopic(FROM), addressTopic(TO)],
        data: uint256(value),
        logIndex: 0,
      },
    ],
  };
}

describe("createArcClient.verifyTokenTransfer (multi-asset)", () => {
  it("confirms an EURC transfer against the EURC token address", async () => {
    const rpc = inMemoryRpc({ receipt: receiptWithTokenTransfer(EURC, 10_000_000n), head: 103n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 5_042_002 },
      rpc,
    );
    const result = await client.verifyTokenTransfer({
      txHash: TX,
      token: EURC,
      to: TO,
      minAmount: money("10", "EURC"),
    });
    expect(result.confirmed).toBe(true);
    expect(result.amount).toEqual(money("10", "EURC"));
    expect(result.confirmations).toBe(4);
  });

  it("does NOT match an EURC transfer when verifying against USDC", async () => {
    const rpc = inMemoryRpc({ receipt: receiptWithTokenTransfer(EURC, 10_000_000n), head: 103n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 5_042_002 },
      rpc,
    );
    // The legacy USDC verifier only matches the configured USDC contract.
    const result = await client.verifyUsdcTransfer({ txHash: TX, to: TO, minAmount: money("10") });
    expect(result.confirmed).toBe(false);
  });
});

describe("createArcClient.estimateTransferFee", () => {
  it("returns a USDC-denominated fee from current gas prices", async () => {
    const rpc = inMemoryRpc({ receipt: null, head: 0n, maxFeePerGas: 1_000_000_000n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 5_042_002 },
      rpc,
    );
    const est = await client.estimateTransferFee();
    // 65000 gas * 1e9 = 6.5e13 native (18-dec) => 65 USDC base units (6-dec).
    expect(est.gasLimit).toBe(65_000n);
    expect(est.feeWei).toBe(65_000_000_000_000n);
    expect(est.fee).toEqual(money("0.000065", "USDC"));
  });

  it("honors a custom gas limit", async () => {
    const rpc = inMemoryRpc({ receipt: null, head: 0n, maxFeePerGas: 2_000_000_000n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 5_042_002 },
      rpc,
    );
    const est = await client.estimateTransferFee({ gasLimit: 100_000n });
    expect(est.feeWei).toBe(200_000_000_000_000n);
    expect(est.fee).toEqual(money("0.0002", "USDC"));
  });
});

describe("createArcClient.getConfirmations", () => {
  it("computes confirmations from head minus receipt block (inclusive)", async () => {
    const rpc = inMemoryRpc({ receipt: receiptWithTransfer(1n), head: 110n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 1 },
      rpc,
    );
    expect(await client.getConfirmations(TX)).toBe(11);
  });

  it("returns 0 when the receipt is missing", async () => {
    const rpc = inMemoryRpc({ receipt: null, head: 110n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 1 },
      rpc,
    );
    expect(await client.getConfirmations("0xmissing")).toBe(0);
  });
});

describe("createArcClient.waitForConfirmations", () => {
  it("resolves immediately when the target is already met", async () => {
    const rpc = inMemoryRpc({ receipt: receiptWithTransfer(1n), head: 105n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 1 },
      rpc,
    );
    const got = await client.waitForConfirmations(TX, { confirmations: 3 });
    expect(got).toBeGreaterThanOrEqual(3);
  });

  it("times out when confirmations never reach the target", async () => {
    const rpc = inMemoryRpc({ receipt: receiptWithTransfer(1n), head: 100n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 1 },
      rpc,
    );
    await expect(
      client.waitForConfirmations(TX, {
        confirmations: 50,
        pollIntervalMs: 1,
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/Timed out/);
  });
});

describe("createArcClient.getTransactionReceipt", () => {
  it("returns the canned receipt", async () => {
    const receipt = receiptWithTransfer(1n);
    const rpc = inMemoryRpc({ receipt, head: 100n });
    const client = createArcClient(
      { rpcUrl: "http://localhost:8545", usdcAddress: USDC, chainId: 1 },
      rpc,
    );
    expect(await client.getTransactionReceipt(TX)).toEqual(receipt);
  });
});
