import { describe, expect, it } from "vitest";
import { decodeFunctionData, maxUint256, type Hex } from "viem";
import { erc20Abi } from "../src/abis.js";
import { PERMIT2_ADDRESS } from "../src/addresses.js";
import { Permit2Billing, permitSingleTypedData, readPermit2Allowance } from "../src/permit2-allowance.js";
import { ChargeDeclinedError, IndeterminateChargeError, type CollectContext } from "../src/provider.js";
import type { OnchainCharge, Permit2Grant } from "../src/types.js";
import { BASE_USDC, Clock, MERCHANT, MONTH, T0, baseChain, operatorAccount, otherAccount, payerAccount, subscriptionFixture, syncChain } from "./helpers.js";

const PRICE = 9_990_000n;

function context(overrides: Partial<CollectContext> = {}, charge: Partial<OnchainCharge> = {}): CollectContext & { steps: string[] } {
  const steps: string[] = [];
  let current: OnchainCharge = {
    id: "och_1", onchainSubscriptionId: "osub_1", periodIndex: 0, network: "base", method: "permit2", amount: PRICE.toString(),
    status: "pending", attempt: 1, leaseUntil: T0.toISOString(), steps: [], createdAt: T0.toISOString(), updatedAt: T0.toISOString(), ...charge,
  };
  return {
    now: T0,
    charge: current,
    priorCollected: 0n,
    steps,
    async recordStep(step, txHash) {
      steps.push(`${step}:${txHash}`);
      current = { ...current, steps: [...current.steps, { step, txHash, at: T0.toISOString() }] };
    },
    ...overrides,
  };
}

async function setup(options: { approvePermit2?: boolean } = {}) {
  const clock = new Clock();
  const chain = baseChain(clock);
  const operator = chain.operator(operatorAccount.address);
  const billing = new Permit2Billing([operator]);
  chain.mint(BASE_USDC, payerAccount.address, 200_000_000n);
  if (options.approvePermit2 ?? true) chain.setErc20Allowance(BASE_USDC, payerAccount.address, PERMIT2_ADDRESS, maxUint256);
  const intent = await billing.createIntent(8453, {
    owner: payerAccount.address, token: BASE_USDC, amountPerPeriod: PRICE, periods: 12, anchor: T0, periodSeconds: MONTH, now: T0,
  });
  const signature = await payerAccount.signTypedData(intent.typedData as never);
  const grant: Permit2Grant = {
    kind: "permit2", chainId: 8453, owner: payerAccount.address, token: BASE_USDC, spender: operator.address,
    amount: intent.permit.details.amount.toString(), expiration: intent.permit.details.expiration, nonce: intent.permit.details.nonce,
    sigDeadline: intent.permit.sigDeadline.toString(), signature,
  };
  return { clock, chain, operator, billing, intent, grant };
}

describe("Permit2 AllowanceTransfer billing", () => {
  it("builds a PermitSingle capped at price x periods, expiring after the last period", async () => {
    const { intent, operator } = await setup();
    expect(intent.permit.details.amount).toBe(PRICE * 12n);
    expect(intent.permit.details.nonce).toBe(0);
    expect(intent.permit.spender).toBe(operator.address);
    expect(intent.permit.details.expiration).toBe(Math.floor(T0.getTime() / 1000) + 12 * MONTH + 7 * 86_400);
    expect(intent.typedData.domain).toMatchObject({ name: "Permit2", chainId: 8453, verifyingContract: PERMIT2_ADDRESS });
    expect(intent.payerCalls).toEqual([]);
  });

  it("asks for the one-time ERC-20 approval of Permit2 when it is missing", async () => {
    const { intent } = await setup({ approvePermit2: false });
    expect(intent.payerCalls).toHaveLength(1);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: intent.payerCalls[0]!.data });
    expect(decoded.args).toEqual([PERMIT2_ADDRESS, maxUint256]);
  });

  it("verifies and registers the grant, then pulls one period straight to the merchant", async () => {
    const { chain, operator, billing, grant } = await setup();
    const accepted = await billing.acceptGrant(grant, T0);
    expect(accepted.permitTxHash).toMatch(/^0x/);
    expect(await readPermit2Allowance(operator, payerAccount.address, BASE_USDC, operator.address)).toMatchObject({ amount: PRICE * 12n, nonce: 1 });

    const ctx = context();
    const outcome = await billing.collect(subscriptionFixture({ grant: accepted }), ctx);
    expect(outcome).toMatchObject({ status: "succeeded" });
    expect(ctx.steps).toHaveLength(1);
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(PRICE);
    expect((await readPermit2Allowance(operator, payerAccount.address, BASE_USDC, operator.address)).amount).toBe(PRICE * 11n);
  });

  it("rejects a grant signed by someone else, or past its deadline", async () => {
    const { billing, grant, intent } = await setup();
    const forged = await otherAccount.signTypedData(intent.typedData as never);
    await expect(billing.acceptGrant({ ...grant, signature: forged }, T0)).rejects.toThrow(ChargeDeclinedError);
    await expect(billing.acceptGrant(grant, new Date(T0.getTime() + 2 * 3_600_000))).rejects.toThrow(/deadline/);
  });

  it("declines when the buyer revoked the Permit2 allowance or the ERC-20 approval", async () => {
    const { chain, billing, grant } = await setup();
    const accepted = await billing.acceptGrant(grant, T0);
    const sub = subscriptionFixture({ grant: accepted });
    await chain.operator(payerAccount.address).write({
      address: PERMIT2_ADDRESS,
      abi: (await import("../src/abis.js")).permit2Abi,
      functionName: "approve",
      args: [BASE_USDC, operatorAccount.address, 0n, 0],
    });
    await expect(billing.collect(sub, context())).rejects.toThrow(/expired|revoked/);

    const fresh = await setup();
    const acceptedFresh = await fresh.billing.acceptGrant(fresh.grant, T0);
    fresh.chain.setErc20Allowance(BASE_USDC, payerAccount.address, PERMIT2_ADDRESS, 0n);
    await expect(fresh.billing.collect(subscriptionFixture({ grant: acceptedFresh }), context())).rejects.toThrow(/ERC-20 approval/);
  });

  it("declines on insufficient balance and after the grant expires", async () => {
    const { chain, billing, grant, clock } = await setup();
    const accepted = await billing.acceptGrant(grant, T0);
    chain.balances.clear();
    await expect(billing.collect(subscriptionFixture({ grant: accepted }), context())).rejects.toThrow(/insufficient/);
    clock.advanceSeconds(13 * MONTH);
    syncChain(chain, clock);
    await expect(billing.collect(subscriptionFixture({ grant: accepted }), context({ now: clock.now() }))).rejects.toThrow(/expired/);
  });

  it("treats a lost receipt as indeterminate and reconciles the recorded tx on resume (no second pull)", async () => {
    const { chain, billing, grant } = await setup();
    const accepted = await billing.acceptGrant(grant, T0);
    const sub = subscriptionFixture({ grant: accepted });
    chain.failNext("transferFrom", "lost_receipt");
    const first = context();
    await expect(billing.collect(sub, first)).rejects.toThrow(IndeterminateChargeError);
    const recorded = first.steps[0]!.split(":")[1] as Hex;

    const resumed = context({}, { steps: [{ step: "transfer", txHash: recorded, at: T0.toISOString() }] });
    await expect(billing.collect(sub, resumed)).rejects.toThrow(IndeterminateChargeError);
    chain.mineLost();
    expect(await billing.collect(sub, resumed)).toEqual({ status: "succeeded", txHash: recorded });
    expect(chain.txs.filter((t) => t.functionName === "transferFrom")).toHaveLength(1);
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(PRICE);
  });

  it("reconciles an unrecorded pull from the remaining allowance instead of pulling twice", async () => {
    const { chain, billing, grant, operator } = await setup();
    const accepted = await billing.acceptGrant(grant, T0);
    const sub = subscriptionFixture({ grant: accepted });
    // A pull landed but the worker crashed before recording its hash.
    await operator.write({ address: PERMIT2_ADDRESS, abi: (await import("../src/abis.js")).permit2Abi, functionName: "transferFrom", args: [payerAccount.address, MERCHANT, PRICE, BASE_USDC] });
    const outcome = await billing.collect(sub, context());
    expect(outcome).toMatchObject({ status: "succeeded", note: expect.stringContaining("reconciled") });
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(PRICE);
  });

  it("maps a reverted pull to a decline", async () => {
    const { chain, billing, grant } = await setup();
    const accepted = await billing.acceptGrant(grant, T0);
    chain.failNext("transferFrom", "revert");
    await expect(billing.collect(subscriptionFixture({ grant: accepted }), context())).rejects.toThrow(/reverted/);
  });

  it("only accepts operators on chains with Permit2", () => {
    const fake = { chainId: 12345 } as never;
    expect(() => new Permit2Billing([fake])).toThrow(/Permit2/);
    expect(permitSingleTypedData(1, { details: { token: BASE_USDC, amount: 1n, expiration: 1, nonce: 0 }, spender: MERCHANT, sigDeadline: 1n }).primaryType).toBe("PermitSingle");
  });
});
