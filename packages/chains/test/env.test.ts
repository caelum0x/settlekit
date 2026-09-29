import { describe, expect, it } from "vitest";
import { ChainConfigError, loadEvmChains, loadZcashConfig } from "../src/index.js";

describe("loadEvmChains", () => {
  it("enables nothing by default (every EVM chain fails closed)", () => {
    expect(loadEvmChains({})).toEqual({ env: "testnet", enabled: {}, notes: [] });
  });

  it("enables listed chains on the default testnet with registry defaults", () => {
    const config = loadEvmChains({ ENABLED_EVM_CHAINS: "tempo, arbitrum" });
    expect(Object.keys(config.enabled).sort()).toEqual(["arbitrum", "tempo"]);
    expect(config.enabled.tempo).toMatchObject({
      rpcUrl: "https://rpc.moderato.tempo.xyz",
      minConfirmations: 1,
      tokenAddress: "0x20c0000000000000000000000000000000000000",
    });
    expect(config.enabled.arbitrum?.spec.chainId).toBe(421614);
  });

  it("switches to mainnet globally and per chain", () => {
    const config = loadEvmChains({
      SETTLEKIT_CHAIN_ENV: "mainnet",
      ENABLED_EVM_CHAINS: "ethereum,hyperevm,robinhood",
      HYPEREVM_NETWORK: "testnet",
      ETHEREUM_RPC_URL: "https://eth.example",
      ETHEREUM_MIN_CONFIRMATIONS: "20",
    });
    expect(config.env).toBe("mainnet");
    expect(config.enabled.ethereum).toMatchObject({ rpcUrl: "https://eth.example", minConfirmations: 20 });
    expect(config.enabled.ethereum?.spec.chainId).toBe(1);
    expect(config.enabled.hyperevm?.spec.chainId).toBe(998);
    expect(config.enabled.robinhood?.spec.token.symbol).toBe("USDG");
  });

  it("keeps the BASE_RPC_URL alias (Base mainnet) and the ARC_CHAIN_ID alias", () => {
    const config = loadEvmChains({ BASE_RPC_URL: "https://mainnet.base.org", ARC_CHAIN_ID: "5042002" });
    expect(config.enabled.base).toMatchObject({ rpcUrl: "https://mainnet.base.org" });
    expect(config.enabled.base?.spec.chainId).toBe(8453);
    expect(config.enabled.arc?.spec.chainId).toBe(5042002);
    const testnetBase = loadEvmChains({ BASE_RPC_URL: "https://sepolia.base.org", BASE_NETWORK: "testnet" });
    expect(testnetBase.enabled.base?.spec.chainId).toBe(84532);
  });

  it("skips an unknown legacy Arc chain id with a note (Arc then fails closed)", () => {
    const config = loadEvmChains({ ARC_CHAIN_ID: "1" });
    expect(config.enabled.arc).toBeUndefined();
    expect(config.notes[0]).toMatch(/ARC_CHAIN_ID 1/);
  });

  it("rejects unknown chains, bad envs, bad numbers and Arc on mainnet", () => {
    expect(() => loadEvmChains({ ENABLED_EVM_CHAINS: "polygon" })).toThrow(ChainConfigError);
    expect(() => loadEvmChains({ SETTLEKIT_CHAIN_ENV: "devnet" })).toThrow(/mainnet or testnet/);
    expect(() => loadEvmChains({ ENABLED_EVM_CHAINS: "base", BASE_MIN_CONFIRMATIONS: "0" })).toThrow(/between 1/);
    expect(() => loadEvmChains({ ENABLED_EVM_CHAINS: "arc", ARC_NETWORK: "mainnet" })).toThrow(/no mainnet/);
  });

  it("allows token overrides outside production only", () => {
    const override = { ENABLED_EVM_CHAINS: "base", BASE_TOKEN_ADDRESS: "0x1111111111111111111111111111111111111111" };
    expect(loadEvmChains(override).enabled.base?.tokenAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(() => loadEvmChains({ ...override, NODE_ENV: "production" })).toThrow(/refused in production/);
    const same = { ENABLED_EVM_CHAINS: "base", BASE_TOKEN_ADDRESS: "0x036cbd53842c5426634e7929541ec2318f3dcf7e", NODE_ENV: "production" };
    expect(loadEvmChains(same).enabled.base?.tokenAddress).toBe("0x036cbd53842c5426634e7929541ec2318f3dcf7e");
    expect(() => loadEvmChains({ ENABLED_EVM_CHAINS: "base", BASE_TOKEN_ADDRESS: "nope" })).toThrow(/20-byte/);
  });
});

describe("loadZcashConfig", () => {
  it("is disabled unless ZCASH_ENABLED is truthy", () => {
    expect(loadZcashConfig({})).toBeNull();
    expect(loadZcashConfig({ ZCASH_ENABLED: "false" })).toBeNull();
    expect(() => loadZcashConfig({ ZCASH_ENABLED: "maybe" })).toThrow(ChainConfigError);
  });

  it("applies defaults and overrides", () => {
    expect(loadZcashConfig({ ZCASH_ENABLED: "true" })).toEqual({
      network: "mainnet",
      explorerUrl: "https://api.blockchair.com/zcash",
      minConfirmations: 3,
      quoteTtlSec: 900,
    });
    expect(
      loadZcashConfig({
        ZCASH_ENABLED: "1",
        ZCASH_EXPLORER_URL: "https://proxy.example/zcash",
        BLOCKCHAIR_API_KEY: "key",
        ZCASH_MIN_CONFIRMATIONS: "6",
        ZCASH_QUOTE_TTL_SEC: "600",
      }),
    ).toEqual({ network: "mainnet", explorerUrl: "https://proxy.example/zcash", apiKey: "key", minConfirmations: 6, quoteTtlSec: 600 });
    expect(() => loadZcashConfig({ ZCASH_ENABLED: "1", ZCASH_EXPLORER_URL: "ftp://x" })).toThrow(/http/);
  });
});
