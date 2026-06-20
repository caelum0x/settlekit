import { describe, expect, it } from "vitest";
import { ARC_TESTNET_REGISTRIES } from "@settlekit/arc-chains";
import { ARC_TESTNET_RPC_URL } from "@settlekit/erc8004";
import { resolveConfig } from "../src/index.js";

describe("resolveConfig", () => {
  it("defaults registries and rpcUrl when config is empty", () => {
    const resolved = resolveConfig();
    expect(resolved.registries).toBe(ARC_TESTNET_REGISTRIES);
    expect(resolved.rpcUrl).toBe(ARC_TESTNET_RPC_URL);
  });

  it("treats undefined config the same as empty config", () => {
    const resolved = resolveConfig(undefined);
    expect(resolved.registries).toBe(ARC_TESTNET_REGISTRIES);
    expect(resolved.rpcUrl).toBe(ARC_TESTNET_RPC_URL);
  });

  it("honors an explicit rpcUrl override", () => {
    const resolved = resolveConfig({ rpcUrl: "https://example.test/rpc" });
    expect(resolved.rpcUrl).toBe("https://example.test/rpc");
    expect(resolved.registries).toBe(ARC_TESTNET_REGISTRIES);
  });

  it("honors explicit registries override", () => {
    const custom = {
      identityRegistry: "0x0000000000000000000000000000000000000001",
      reputationRegistry: "0x0000000000000000000000000000000000000002",
      validationRegistry: "0x0000000000000000000000000000000000000003",
    };
    const resolved = resolveConfig({ registries: custom });
    expect(resolved.registries).toBe(custom);
  });

  it("does not mutate the input config", () => {
    const input = { rpcUrl: "https://example.test/rpc" } as const;
    const resolved = resolveConfig(input);
    expect(resolved).not.toBe(input);
    expect(input).toEqual({ rpcUrl: "https://example.test/rpc" });
  });

  it("passes through privateKey without inventing one", () => {
    expect(resolveConfig().privateKey).toBeUndefined();
  });
});
