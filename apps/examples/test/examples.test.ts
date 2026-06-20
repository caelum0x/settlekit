/**
 * Integration tests: every example's exported `main()` runs end-to-end against
 * the REAL @settlekit packages and completes successfully with the expected
 * shape. No mocks of the packages — only in-memory stores/adapters the packages
 * are designed to accept.
 */
import { describe, it, expect } from "vitest";

import { main as saasEntitlementCheck } from "../src/saas-entitlement-check.js";
import { main as x402PaidApi } from "../src/x402-paid-api.js";
import { main as licenseVerify } from "../src/license-verify.js";
import { main as githubRepoSale } from "../src/github-repo-sale.js";
import { main as bundleCheckout } from "../src/bundle-checkout.js";
import { main as arcCommerce } from "../src/arc-commerce.js";
import { main as runAllMain, runAll } from "../src/run-all.js";

import { LocalAppKitSdk, configureAppKit } from "@settlekit/app-kit";

describe("saas-entitlement-check", () => {
  it("grants a plan entitlement, verifies a feature, and deducts credits", async () => {
    const result = await saasEntitlementCheck();
    expect(result.planId).toMatch(/^price_/);
    expect(result.entitlementId).toMatch(/^ent_/);
    expect(result.featureAllowed).toBe(true);
    expect(result.featureValue).toBe(true);
    expect(result.creditsBefore).toBe(1000);
    expect(result.creditsAfter).toBe(975);
  });
});

describe("x402-paid-api", () => {
  it("returns 402 then 200 after a verified payment and meters the call", async () => {
    const result = await x402PaidApi();
    expect(result.challengeStatus).toBe(402);
    expect(result.challengeAmount).toBe("0.005");
    expect(result.paidStatus).toBe(200);
    expect(result.meteredCalls).toBe(1);
    expect(result.paidBody).toMatchObject({ insight: expect.any(String) });
  });
});

describe("license-verify", () => {
  it("activates within the machine limit and rejects over it", async () => {
    const result = await licenseVerify();
    expect(result.licenseId).toMatch(/^lic_/);
    expect(result.key.length).toBeGreaterThan(0);
    expect(result.machine1Active).toBe(true);
    expect(result.machine2Active).toBe(true);
    expect(result.machine3Active).toBe(false);
    expect(result.machine3Reason).toBe("machine_limit_exceeded");
    expect(result.tokenValid).toBe(true);
  });
});

describe("github-repo-sale", () => {
  it("runs a github_invite delivery plan to success", async () => {
    const result = await githubRepoSale();
    expect(result.runStatus).toBe("succeeded");
    expect(result.actionStatus).toBe("succeeded");
    expect(result.invitedUsername).toBe("octo-buyer");
    expect(result.repo).toBe("acme/private-toolkit");
    expect(result.invitationId).toBeTypeOf("number");
    expect(result.inviteCalls).toBe(1);
  });
});

describe("bundle-checkout", () => {
  it("builds a merged delivery plan and per-member entitlements", async () => {
    const result = await bundleCheckout();
    expect(result.bundleId).toMatch(/^bndl_/);
    expect(result.bundlePrice).toBe("149");
    expect(result.deliveryPlanId).toMatch(/^dplan_/);
    expect(result.actionTypes).toEqual(["github_invite", "license_key_create"]);
    expect(result.entitlementCount).toBe(2);
    expect(result.entitlementTypes).toEqual(["github_repo_access", "license_key"]);
  });
});

describe("arc-commerce", () => {
  const HASH_RE = /^0xlocal[0-9a-f]{8}$/;

  it("accepts USDC on Arc and settles a bridged payment to success", async () => {
    const result = await arcCommerce();

    // Order total equals the summed line items (19.99 + 29.01 = 49).
    expect(result.order.items).toHaveLength(2);
    expect(result.total).toBe("49");
    expect(result.order.totalUsdc).toBe("49");
    expect(result.total).toBe(result.order.totalUsdc);

    // Same-chain leg: deterministic synthetic hash + Arc explorer URL.
    expect(result.sameChain.status).toBe("success");
    expect(result.sameChain.txHash).toMatch(HASH_RE);
    expect(result.sameChain.explorerUrl).toContain("testnet.arcscan.app");
    expect(result.sameChain.amountUsdc).toBe("49");

    // Bridged leg: distinct synthetic hash, also success.
    expect(result.bridged.status).toBe("success");
    expect(result.bridged.txHash).toMatch(HASH_RE);
    expect(result.bridged.txHash).not.toBe(result.sameChain.txHash);

    expect(result.allSucceeded).toBe(true);
  });

  it("is deterministic per run (each run builds its own local SDK)", async () => {
    const first = await arcCommerce();
    const second = await arcCommerce();
    // Per-run shape is stable; hashes restart each run, so assert shape only.
    expect(first.sameChain.txHash).toMatch(/^0xlocal/);
    expect(second.sameChain.txHash).toMatch(/^0xlocal/);
    expect(first.total).toBe(second.total);
  });

  it("surfaces a typed integration error when the bridge throws", async () => {
    const arc = configureAppKit({
      sdk: new LocalAppKitSdk({ throwOn: ["bridge"] }),
      kitKey: "k",
    });
    const res = await arc.bridge({
      adapter: "demo-viem-adapter",
      fromChain: "Base_Sepolia",
      toChain: "Arc_Testnet",
      amount: "49",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("integration_error");
    }
  });

  it("fails a send when the SDK reports a reverted state", async () => {
    const arc = configureAppKit({
      sdk: new LocalAppKitSdk({ state: "reverted" }),
      kitKey: "k",
    });
    const res = await arc.send({
      adapter: "demo-viem-adapter",
      chain: "Arc_Testnet",
      to: "0xMerchantArcWallet",
      amount: "49",
      token: "USDC",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("payment_failed");
    }
  });
});

describe("run-all", () => {
  it("reports every example as ok", async () => {
    const reports = await runAll();
    expect(reports).toHaveLength(5);
    for (const report of reports) {
      expect(report.ok, `${report.name}: ${report.error ?? ""}`).toBe(true);
    }
  });

  it("main() resolves when all examples pass", async () => {
    await expect(runAllMain()).resolves.toHaveLength(5);
  });
});
