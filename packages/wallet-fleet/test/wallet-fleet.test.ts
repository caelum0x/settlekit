import { describe, expect, it } from "vitest";
import { money } from "@settlekit/common";
import type { CircleTokenBalance, CircleWalletResource, WalletsClient } from "@settlekit/circle-wallets";
import { InMemoryWalletRegistry } from "../src/registry.js";
import { SpendingCapEnforcer } from "../src/caps.js";
import { createCircleBalances } from "../src/balances.js";
import { createCircleProvisioner } from "../src/provisioning.js";

describe("InMemoryWalletRegistry", () => {
  it("registers and looks up wallets, and honours the kill-switch", async () => {
    const registry = new InMemoryWalletRegistry();
    const w = await registry.register({
      ownerType: "agent",
      ownerId: "agent_1",
      address: "0xAbc",
      circleWalletId: "cw_1",
    });
    expect(await registry.getById(w.id)).toEqual(w);
    expect(await registry.getByAddress("0xabc")).toEqual(w);
    expect(await registry.listByOwner("agent", "agent_1")).toHaveLength(1);
    const killed = await registry.setKilled(w.id, true);
    expect(killed?.killed).toBe(true);
  });
});

describe("SpendingCapEnforcer", () => {
  const wallet = {
    id: "flw_1",
    ownerType: "agent" as const,
    ownerId: "a",
    address: "0x1",
    network: "arc" as const,
    killed: false,
    createdAt: "2026-06-18T00:00:00.000Z",
  };

  it("enforces per-tx and per-day caps", () => {
    const enforcer = new SpendingCapEnforcer(() => Date.parse("2026-06-18T10:00:00Z"));
    const caps = { perTxUsdc: "0.01", perDayUsdc: "0.02" };

    expect(enforcer.authorize(wallet, caps, money("0.05")).allowed).toBe(false); // over per-tx
    expect(enforcer.authorize(wallet, caps, money("0.01")).allowed).toBe(true);

    enforcer.record(wallet.id, money("0.01"));
    enforcer.record(wallet.id, money("0.01"));
    expect(enforcer.spentTodayUsdc(wallet.id)).toBe("0.02");
    // Daily cap now reached.
    expect(enforcer.authorize(wallet, caps, money("0.01")).allowed).toBe(false);
  });

  it("denies all spend when the wallet is killed", () => {
    const enforcer = new SpendingCapEnforcer();
    const result = enforcer.authorize({ ...wallet, killed: true }, {}, money("0.001"));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("wallet killed");
  });

  it("resets the daily total across UTC days", () => {
    let t = Date.parse("2026-06-18T23:59:00Z");
    const enforcer = new SpendingCapEnforcer(() => t);
    enforcer.record(wallet.id, money("0.02"));
    expect(enforcer.spentTodayUsdc(wallet.id)).toBe("0.02");
    t = Date.parse("2026-06-19T00:01:00Z");
    expect(enforcer.spentTodayUsdc(wallet.id)).toBe("0");
  });
});

describe("createCircleBalances", () => {
  it("reads the USDC balance for a wallet", async () => {
    const wallets = {
      getWalletBalance: async (): Promise<CircleTokenBalance[]> => [
        { token: { symbol: "USDC" }, amount: "12.5", updateDate: "" } as unknown as CircleTokenBalance,
      ],
    } as unknown as WalletsClient;
    const balances = createCircleBalances(wallets);
    expect((await balances.getUsdcBalance("cw_1")).amount).toBe("12.5");
  });
});

describe("createCircleProvisioner", () => {
  it("creates a Circle wallet and registers it in the fleet", async () => {
    const registry = new InMemoryWalletRegistry();
    const wallets = {
      createWallets: async (): Promise<CircleWalletResource[]> => [
        { id: "cw_9", address: "0xNew" } as unknown as CircleWalletResource,
      ],
    } as unknown as WalletsClient;

    const provisioner = createCircleProvisioner({
      wallets,
      walletSetId: "ws_1",
      blockchain: "ARB-SEPOLIA",
      network: "arc",
      registry,
    });

    const wallet = await provisioner.provision({ ownerType: "creator", ownerId: "creator_1" });
    expect(wallet.address).toBe("0xNew");
    expect(wallet.circleWalletId).toBe("cw_9");
    expect(await registry.listByOwner("creator", "creator_1")).toHaveLength(1);
  });
});
