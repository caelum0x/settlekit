import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

const prodSecrets = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/settlekit",
  LICENSE_TOKEN_SECRET: "a-real-license-secret",
  WEBHOOK_SIGNING_SECRET: "a-real-webhook-secret",
  AUTH_COOKIE_SECRET: "a-real-auth-cookie-secret",
};

describe("loadConfig production fail-closed guard", () => {
  it("boots with dev defaults when NODE_ENV is not production", () => {
    expect(() => loadConfig({})).not.toThrow();
  });

  it("refuses to boot in production without DATABASE_URL", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/DATABASE_URL must be set/);
  });

  it("refuses to boot in production with dev-default signing secrets", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", DATABASE_URL: prodSecrets.DATABASE_URL }),
    ).toThrow(/LICENSE_TOKEN_SECRET must be set/);
  });

  it("boots in production once DB and real secrets are supplied", () => {
    expect(() => loadConfig({ NODE_ENV: "production", ...prodSecrets })).not.toThrow();
  });
});

describe("loadConfig chain verifiers", () => {
  it("leaves solana and base unset by default", () => {
    const cfg = loadConfig({});
    expect(cfg.solana).toBeNull();
    expect(cfg.base).toBeNull();
    expect(cfg.hasSolana).toBe(false);
  });

  it("derives the RPC URL and USDC mint from SOLANA_CLUSTER", () => {
    const cfg = loadConfig({ SOLANA_CLUSTER: "devnet" });
    expect(cfg.solana).toEqual({
      cluster: "devnet",
      rpcUrl: "https://api.devnet.solana.com",
      usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    });
    const mainnet = loadConfig({ SOLANA_CLUSTER: "mainnet-beta", SOLANA_RPC_URL: "https://rpc.example.com" });
    expect(mainnet.solana).toMatchObject({
      cluster: "mainnet",
      rpcUrl: "https://rpc.example.com",
      usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
  });

  it("rejects partial or malformed solana configuration", () => {
    expect(() => loadConfig({ SOLANA_RPC_URL: "https://rpc.example.com" })).toThrow(/SOLANA_CLUSTER/);
    expect(() => loadConfig({ SOLANA_CLUSTER: "testnet" })).toThrow(/mainnet or devnet/);
    expect(() => loadConfig({ SOLANA_CLUSTER: "devnet", SOLANA_USDC_MINT: "0xabc" })).toThrow(/base58/);
  });

  it("enables Base verification with the canonical USDC contract", () => {
    const cfg = loadConfig({ BASE_RPC_URL: "https://mainnet.base.org" });
    expect(cfg.base).toEqual({
      rpcUrl: "https://mainnet.base.org",
      usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      chainId: 8453,
      minConfirmations: 3,
    });
  });
});
