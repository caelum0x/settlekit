import { describe, expect, it } from "vitest";
import { fromBaseUnits } from "@settlekit/common";
import {
  decodeTransferLog,
  decodeTransfers,
} from "../src/decode.js";
import { TRANSFER_EVENT_TOPIC } from "../src/usdc-abi.js";
import type { ArcLog, ArcTransactionReceipt, Hex } from "../src/types.js";

const USDC: Hex = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const FROM: Hex = "0x1111111111111111111111111111111111111111";
const TO: Hex = "0x2222222222222222222222222222222222222222";

/** Left-pad an address into a 32-byte topic (12 zero bytes + 20-byte addr). */
function addressTopic(address: Hex): Hex {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex;
}

/** Encode a bigint into a 32-byte hex word. */
function uint256(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

/** Build a real ERC-20 Transfer log fixture. */
function transferLog(args: {
  address: Hex;
  from: Hex;
  to: Hex;
  value: bigint;
  logIndex?: number;
}): ArcLog {
  return {
    address: args.address,
    topics: [
      TRANSFER_EVENT_TOPIC,
      addressTopic(args.from),
      addressTopic(args.to),
    ],
    data: uint256(args.value),
    logIndex: args.logIndex ?? 0,
  };
}

describe("decodeTransferLog", () => {
  it("decodes a real ERC-20 Transfer log fixture", () => {
    // 25.5 USDC => 25_500_000 base units (6 decimals)
    const value = 25_500_000n;
    const log = transferLog({ address: USDC, from: FROM, to: TO, value });

    const decoded = decodeTransferLog(log, USDC);
    expect(decoded).not.toBeNull();
    expect(decoded?.from).toBe(FROM.toLowerCase());
    expect(decoded?.to).toBe(TO.toLowerCase());
    expect(decoded?.value).toBe(value);
    expect(fromBaseUnits(decoded!.value)).toBe("25.5");
  });

  it("ignores logs from a different contract address", () => {
    const other: Hex = "0x9999999999999999999999999999999999999999";
    const log = transferLog({ address: other, from: FROM, to: TO, value: 1n });
    expect(decodeTransferLog(log, USDC)).toBeNull();
  });

  it("ignores non-Transfer events", () => {
    const approval: Hex =
      "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
    const log: ArcLog = {
      address: USDC,
      topics: [approval, addressTopic(FROM), addressTopic(TO)],
      data: uint256(1n),
      logIndex: 0,
    };
    expect(decodeTransferLog(log, USDC)).toBeNull();
  });

  it("returns null for an empty-topics log", () => {
    const log: ArcLog = { address: USDC, topics: [], data: "0x", logIndex: 0 };
    expect(decodeTransferLog(log, USDC)).toBeNull();
  });
});

describe("decodeTransfers", () => {
  it("decodes only matching USDC transfers from a receipt", () => {
    const receipt: ArcTransactionReceipt = {
      transactionHash: "0xabc",
      blockNumber: 100n,
      status: "success",
      from: FROM,
      to: USDC,
      logs: [
        transferLog({ address: USDC, from: FROM, to: TO, value: 1_000_000n, logIndex: 0 }),
        transferLog({
          address: "0x9999999999999999999999999999999999999999",
          from: FROM,
          to: TO,
          value: 5_000_000n,
          logIndex: 1,
        }),
        transferLog({ address: USDC, from: TO, to: FROM, value: 2_000_000n, logIndex: 2 }),
      ],
    };

    const transfers = decodeTransfers(receipt, USDC);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]?.value).toBe(1_000_000n);
    expect(transfers[1]?.value).toBe(2_000_000n);
  });
});
