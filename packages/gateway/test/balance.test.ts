import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { ARC_TESTNET } from "@settlekit/arc";
import { readGatewayBalance, sumUnifiedAvailable } from "../src/balance.js";
import type { BalanceGetter, GatewayRpc } from "../src/balance.js";
import { createGatewayClient } from "../src/client.js";
import type { Address, Hex } from "../src/types.js";

const WALLET = getAddress(ARC_TESTNET.contracts.gatewayWallet) as Address;
const USDC = getAddress(ARC_TESTNET.tokens.USDC.address) as Address;
const DEPOSITOR = getAddress("0x1111111111111111111111111111111111111111") as Address;

/** In-memory RPC returning canned per-getter balances. */
function stubRpc(values: Record<BalanceGetter, bigint>): {
  rpc: GatewayRpc;
  calls: BalanceGetter[];
} {
  const calls: BalanceGetter[] = [];
  return {
    calls,
    rpc: {
      async readBalance(params): Promise<bigint> {
        calls.push(params.getter);
        return values[params.getter];
      },
    },
  };
}

describe("sumUnifiedAvailable", () => {
  it("sums per-chain available balances", () => {
    expect(
      sumUnifiedAvailable([
        { domain: 0, available: 5_000_000n },
        { domain: 26, available: 10_500_000n },
      ]),
    ).toBe(15_500_000n);
  });

  it("returns zero for no chains", () => {
    expect(sumUnifiedAvailable([])).toBe(0n);
  });
});

describe("readGatewayBalance", () => {
  it("reads all four getters concurrently into a breakdown", async () => {
    const { rpc, calls } = stubRpc({
      totalBalance: 30_000_000n,
      availableBalance: 20_000_000n,
      withdrawingBalance: 10_000_000n,
      withdrawableBalance: 0n,
    });
    const out = await readGatewayBalance(rpc, {
      gatewayWallet: WALLET,
      token: USDC,
      depositor: DEPOSITOR,
    });
    expect(out).toEqual({
      total: 30_000_000n,
      available: 20_000_000n,
      withdrawing: 10_000_000n,
      withdrawable: 0n,
    });
    expect(calls.sort()).toEqual(
      ["availableBalance", "totalBalance", "withdrawableBalance", "withdrawingBalance"].sort(),
    );
  });
});

describe("createGatewayClient.readChainBalance", () => {
  it("uses an injected rpc and checksums addresses", async () => {
    const { rpc } = stubRpc({
      totalBalance: 7n,
      availableBalance: 7n,
      withdrawingBalance: 0n,
      withdrawableBalance: 0n,
    });
    const client = createGatewayClient({ rpc });
    const out = await client.readChainBalance({
      gatewayWallet: WALLET.toLowerCase(),
      token: USDC.toLowerCase(),
      depositor: DEPOSITOR.toLowerCase() as Hex,
    });
    expect(out.available).toBe(7n);
  });

  it("throws when no rpc or rpcUrl is configured", async () => {
    const client = createGatewayClient({});
    await expect(
      client.readChainBalance({
        gatewayWallet: WALLET,
        token: USDC,
        depositor: DEPOSITOR,
      }),
    ).rejects.toThrow(/rpcUrl/);
  });
});

describe("createGatewayClient encoder passthrough", () => {
  it("exposes unifiedAvailable and buildDeposit", () => {
    const client = createGatewayClient({});
    expect(client.unifiedAvailable([{ domain: 0, available: 3n }])).toBe(3n);
    const tx = client.buildDeposit({
      gatewayWallet: WALLET,
      token: USDC,
      value: 1_000_000n,
    });
    expect(tx.to.toLowerCase()).toBe(WALLET.toLowerCase());
  });
});
