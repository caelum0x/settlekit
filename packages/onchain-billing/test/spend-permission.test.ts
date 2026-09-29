import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import deployments from "./fixtures/deployments.json" with { type: "json" };
import { SPEND_PERMISSION_MANAGER, hasSpendPermissionManager } from "../src/addresses.js";
import { DeferChargeError, IndeterminateChargeError, type CollectContext } from "../src/provider.js";
import {
  SpendPermissionBilling,
  hashSpendPermission,
  spendPermissionFromJson,
  spendPermissionToJson,
} from "../src/spend-permission.js";
import type { OnchainCharge, SpendPermissionGrant } from "../src/types.js";
import { BASE_USDC, Clock, MERCHANT, MONTH, T0, baseChain, operatorAccount, otherAccount, payerAccount, subscriptionFixture, syncChain } from "./helpers.js";

const PRICE = 9_990_000n;

function context(periodIndex = 0, steps: OnchainCharge["steps"] = [], now = T0): CollectContext & { recorded: string[] } {
  const recorded: string[] = [];
  return {
    now,
    priorCollected: 0n,
    charge: {
      id: "och_1", onchainSubscriptionId: "osub_1", periodIndex, network: "base", method: "spend_permission", amount: PRICE.toString(),
      status: "pending", attempt: 1, leaseUntil: T0.toISOString(), steps, createdAt: T0.toISOString(), updatedAt: T0.toISOString(),
    },
    recorded,
    async recordStep(step, txHash) {
      recorded.push(`${step}:${txHash}`);
    },
  };
}

async function setup() {
  const clock = new Clock();
  const chain = baseChain(clock);
  const operator = chain.operator(operatorAccount.address);
  const billing = new SpendPermissionBilling([operator]);
  chain.mint(BASE_USDC, payerAccount.address, 100_000_000n);
  const intent = billing.createIntent(8453, { account: payerAccount.address, token: BASE_USDC, amountPerPeriod: PRICE, periodSeconds: MONTH, anchor: T0, periods: 12, salt: 9n });
  const signature = await payerAccount.signTypedData(intent.typedData as never);
  const grant: SpendPermissionGrant = { kind: "spend_permission", chainId: 8453, permission: spendPermissionToJson(intent.permission), signature };
  return { clock, chain, operator, billing, intent, grant };
}

describe("SpendPermission hashing (golden vectors recorded from SpendPermissionManager.getHash)", () => {
  it("matches the deployed manager on Base, Base Sepolia and Ethereum", () => {
    const sample = spendPermissionFromJson(deployments.samples.spendPermission);
    expect(hashSpendPermission(8453, sample)).toBe(deployments.goldens["8453"].spendPermissionHash);
    expect(hashSpendPermission(84532, sample)).toBe(deployments.goldens["84532"].spendPermissionHash);
    expect(hashSpendPermission(1, sample)).toBe(deployments.goldens["1"].spendPermissionHash);
  });

  it("records the manager on Ethereum, Base, Arbitrum and Robinhood but not HyperEVM or Tempo", () => {
    const sizes = deployments.spendPermissionManager as Record<string, number>;
    for (const chainId of [1, 8453, 42161, 4663, 11155111, 84532]) {
      expect(sizes[String(chainId)]).toBeGreaterThan(0);
      expect(hasSpendPermissionManager(chainId)).toBe(true);
    }
    for (const chainId of [999, 4217, 998, 42431]) {
      expect(sizes[String(chainId)]).toBe(0);
      expect(hasSpendPermissionManager(chainId)).toBe(false);
    }
  });
});

describe("SpendPermissionBilling", () => {
  it("asks the smart wallet for a recurring allowance of one price per period", async () => {
    const { intent, operator } = await setup();
    const start = Math.floor(T0.getTime() / 1000);
    expect(intent.permission).toMatchObject({ spender: operator.address, allowance: PRICE, period: MONTH, start, end: start + 12 * MONTH, extraData: "0x" });
    expect(intent.typedData.domain).toEqual({ name: "Spend Permission Manager", version: "1", chainId: 8453, verifyingContract: SPEND_PERMISSION_MANAGER });
  });

  it("approves with the signature, spends one period and forwards it to the merchant", async () => {
    const { chain, billing, grant } = await setup();
    const accepted = await billing.acceptGrant(grant);
    expect(accepted.approveTxHash).toMatch(/^0x/);
    const ctx = context();
    const outcome = await billing.collect(subscriptionFixture({ method: "spend_permission", grant: accepted }), ctx);
    expect(outcome.status).toBe("succeeded");
    expect(ctx.recorded.map((r) => r.split(":")[0])).toEqual(["spend", "forward"]);
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(PRICE);
    expect(chain.balanceOf(BASE_USDC, operatorAccount.address)).toBe(0n);
    // Re-approving is a no-op once the manager has the permission.
    expect((await billing.acceptGrant(grant)).approveTxHash).toBeUndefined();
  });

  it("retries a failed forward without spending the period again", async () => {
    const { chain, billing, grant } = await setup();
    const accepted = await billing.acceptGrant(grant);
    const sub = subscriptionFixture({ method: "spend_permission", grant: accepted });
    chain.failNext("transfer", "revert");
    await expect(billing.collect(sub, context())).rejects.toThrow(/reverted/);
    // The engine retries the failed period with fresh steps: forward only.
    const retry = context();
    await billing.collect(sub, retry);
    expect(retry.recorded.map((r) => r.split(":")[0])).toEqual(["forward"]);
    expect(chain.txs.filter((t) => t.functionName === "spend")).toHaveLength(1);
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(PRICE);
    // A third attempt finds the period spent and the operator empty: never pays twice.
    await expect(billing.collect(sub, context())).rejects.toThrow(IndeterminateChargeError);
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(PRICE);
  });

  it("resumes after a crash between spend and forward without spending again", async () => {
    const { chain, billing, grant } = await setup();
    const accepted = await billing.acceptGrant(grant);
    const sub = subscriptionFixture({ method: "spend_permission", grant: accepted });
    chain.failNext("transfer", "throw_on_write");
    const first = context();
    await expect(billing.collect(sub, first)).rejects.toThrow(/rpc unavailable/);
    const spendHash = first.recorded[0]!.split(":")[1] as Hex;
    const resumed = context(0, [{ step: "spend", txHash: spendHash, at: T0.toISOString() }]);
    const outcome = await billing.collect(sub, resumed);
    expect(outcome).toEqual({ status: "succeeded", txHash: spendHash });
    expect(chain.txs.filter((t) => t.functionName === "spend")).toHaveLength(1);
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(PRICE);
  });

  it("defers when the chain clock is still in the previous manager period", async () => {
    const { billing, grant } = await setup();
    const accepted = await billing.acceptGrant(grant);
    await expect(billing.collect(subscriptionFixture({ method: "spend_permission", grant: accepted }), context(1))).rejects.toThrow(DeferChargeError);
  });

  it("charges the next period once time advances, and declines after revocation", async () => {
    const { chain, billing, grant, clock } = await setup();
    const accepted = await billing.acceptGrant(grant);
    const sub = subscriptionFixture({ method: "spend_permission", grant: accepted });
    await billing.collect(sub, context());
    clock.advanceSeconds(MONTH);
    syncChain(chain, clock);
    await billing.collect(sub, context(1, [], clock.now()));
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(2n * PRICE);
    expect(await billing.revokeAsSpender(accepted)).toMatch(/^0x/);
    clock.advanceSeconds(MONTH);
    syncChain(chain, clock);
    await expect(billing.collect(sub, context(2, [], clock.now()))).rejects.toThrow(/revoked/);
  });

  it("rejects a signature that is not the account's", async () => {
    const { billing, grant, intent } = await setup();
    const forged = await otherAccount.signTypedData(intent.typedData as never);
    await expect(billing.acceptGrant({ ...grant, signature: forged })).rejects.toThrow(/signature/);
  });

  it("surfaces a lost forward receipt as indeterminate", async () => {
    const { chain, billing, grant } = await setup();
    const accepted = await billing.acceptGrant(grant);
    chain.failNext("transfer", "lost_receipt");
    await expect(billing.collect(subscriptionFixture({ method: "spend_permission", grant: accepted }), context())).rejects.toThrow(IndeterminateChargeError);
  });
});
