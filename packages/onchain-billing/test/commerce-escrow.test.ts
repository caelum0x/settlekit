import { describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, toBytes, zeroAddress, type Hex } from "viem";
import deployments from "./fixtures/deployments.json" with { type: "json" };
import { authCaptureEscrowAbi, erc20Abi, preApprovalCollectorAbi } from "../src/abis.js";
import { COMMERCE_PAYMENTS_V1_1, commercePaymentsFor } from "../src/addresses.js";
import {
  CommerceEscrowClient,
  PAYMENT_INFO_TYPEHASH,
  assertFee,
  erc3009AuthorizationTypedData,
  hashPaymentInfo,
  paymentInfoFromJson,
  paymentInfoToJson,
  payerAgnosticHash,
  permit2TransferTypedData,
  preApprovalCalls,
  reclaimCall,
  validatePaymentInfo,
  type PaymentInfo,
} from "../src/commerce-escrow.js";
import { EscrowPaymentService } from "../src/escrow-records.js";
import { InMemoryOnchainBillingStore } from "../src/store.js";
import { BASE_USDC, Clock, MERCHANT, baseChain, operatorAccount, payerAccount } from "./helpers.js";

const sample = paymentInfoFromJson(deployments.samples.paymentInfo);

describe("PaymentInfo hashing (golden vectors recorded from AuthCaptureEscrow v1.1)", () => {
  it("matches the contract's PAYMENT_INFO_TYPEHASH", () => {
    expect(PAYMENT_INFO_TYPEHASH).toBe(deployments.goldens["8453"].paymentInfoTypehash);
    expect(PAYMENT_INFO_TYPEHASH).toBe(deployments.goldens["84532"].paymentInfoTypehash);
  });

  it("matches AuthCaptureEscrow.getHash on Base mainnet and Base Sepolia", () => {
    expect(hashPaymentInfo(sample, 8453)).toBe(deployments.goldens["8453"].paymentInfoHash);
    expect(hashPaymentInfo(sample, 84532)).toBe(deployments.goldens["84532"].paymentInfoHash);
  });

  it("round-trips through JSON and derives the payer-agnostic hash", () => {
    expect(paymentInfoFromJson(paymentInfoToJson(sample))).toEqual(sample);
    expect(payerAgnosticHash(sample, 8453)).toBe(hashPaymentInfo({ ...sample, payer: zeroAddress }, 8453));
    expect(payerAgnosticHash(sample, 8453)).not.toBe(hashPaymentInfo(sample, 8453));
  });
});

describe("deployment fixtures", () => {
  it("recorded bytecode at every commerce-payments v1.1 address on both Base chains", () => {
    for (const chainId of ["8453", "84532"] as const) {
      const recorded = deployments.commercePayments[chainId] as Record<string, { address: string; bytes: number; keccak256: string | null }>;
      for (const [name, address] of Object.entries(COMMERCE_PAYMENTS_V1_1)) {
        expect(recorded[name]?.address).toBe(address);
        expect(recorded[name]?.bytes).toBeGreaterThan(0);
      }
      // CREATE2: identical runtime code on mainnet and Sepolia.
      expect(recorded.authCaptureEscrow?.keccak256).toBe(deployments.commercePayments["8453"].authCaptureEscrow.keccak256);
    }
    expect(commercePaymentsFor(8453)).toBeDefined();
    expect(commercePaymentsFor(42161)).toBeUndefined();
  });
});

describe("PaymentInfo validation and fees", () => {
  it("enforces the contract's expiry ordering and fee bounds", () => {
    expect(() => validatePaymentInfo(sample)).not.toThrow();
    expect(() => validatePaymentInfo({ ...sample, authorizationExpiry: sample.preApprovalExpiry - 1 })).toThrow(/expiries/);
    expect(() => validatePaymentInfo({ ...sample, maxFeeBps: 10_001 })).toThrow(/fee bps/);
    expect(() => validatePaymentInfo({ ...sample, minFeeBps: 300 })).toThrow(/fee bps/);
    expect(() => validatePaymentInfo({ ...sample, maxAmount: 0n })).toThrow(/maxAmount/);
    expect(() => validatePaymentInfo({ ...sample, maxAmount: 1n << 120n })).toThrow(/maxAmount/);
  });

  it("applies the v1.1 absolute-fee rule", () => {
    // 2.5% of 25 USDC = 0.625 USDC max
    expect(() => assertFee(sample, 25_000_000n, 625_000n, sample.feeReceiver)).not.toThrow();
    expect(() => assertFee(sample, 25_000_000n, 625_001n, sample.feeReceiver)).toThrow(/bounds/);
    expect(() => assertFee(sample, 25_000_000n, 1n, MERCHANT)).toThrow(/fee receiver/);
    expect(() => assertFee({ ...sample, feeReceiver: zeroAddress }, 25_000_000n, 1n, zeroAddress)).toThrow(/needs a fee receiver/);
  });
});

describe("payer-side payloads", () => {
  it("binds the ERC-3009 authorization to the collector, maxAmount, expiry and payer-agnostic nonce", () => {
    const typed = erc3009AuthorizationTypedData(sample, 8453, { name: "USD Coin", version: "2" });
    expect(typed.domain).toMatchObject({ name: "USD Coin", version: "2", chainId: 8453, verifyingContract: sample.token });
    expect(typed.message).toMatchObject({
      from: sample.payer,
      to: COMMERCE_PAYMENTS_V1_1.erc3009PaymentCollector,
      value: sample.maxAmount,
      validAfter: 0n,
      validBefore: BigInt(sample.preApprovalExpiry),
      nonce: payerAgnosticHash(sample, 8453),
    });
  });

  it("builds the Permit2 SignatureTransfer for the Permit2 collector", () => {
    const typed = permit2TransferTypedData(sample, 8453);
    expect(typed.message).toMatchObject({
      spender: COMMERCE_PAYMENTS_V1_1.permit2PaymentCollector,
      nonce: BigInt(payerAgnosticHash(sample, 8453)),
      deadline: BigInt(sample.preApprovalExpiry),
      permitted: { token: sample.token, amount: sample.maxAmount },
    });
  });

  it("encodes the pre-approval and reclaim calls", () => {
    const [approve, preApprove] = preApprovalCalls(sample, 8453);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data }).args).toEqual([COMMERCE_PAYMENTS_V1_1.preApprovalPaymentCollector, sample.maxAmount]);
    expect(decodeFunctionData({ abi: preApprovalCollectorAbi, data: preApprove!.data }).functionName).toBe("preApprove");
    const reclaim = reclaimCall(sample, 8453);
    expect(reclaim.to).toBe(COMMERCE_PAYMENTS_V1_1.authCaptureEscrow);
    expect(decodeFunctionData({ abi: authCaptureEscrowAbi, data: reclaim.data }).functionName).toBe("reclaim");
  });
});

async function escrowSetup() {
  const clock = new Clock();
  const chain = baseChain(clock);
  const operator = chain.operator(operatorAccount.address);
  const client = new CommerceEscrowClient(operator);
  const store = new InMemoryOnchainBillingStore();
  const service = new EscrowPaymentService(client, store, clock.now, () => 7n);
  chain.mint(BASE_USDC, payerAccount.address, 100_000_000n);
  const intent = await service.createIntent({
    id: "esc_1",
    organizationId: "org_1",
    payer: payerAccount.address,
    receiver: MERCHANT,
    token: BASE_USDC,
    amount: 25_000_000n,
    collector: "erc3009",
    tokenDomain: { name: "USD Coin", version: "2" },
  });
  const signature = await payerAccount.signTypedData(intent.typedData as never);
  return { clock, chain, operator, client, store, service, intent, signature };
}

describe("EscrowPaymentService on a simulated AuthCaptureEscrow", () => {
  it("authorizes with the payer's ERC-3009 signature, captures, then refunds via OperatorRefundCollector", async () => {
    const { chain, service, intent, signature, client } = await escrowSetup();
    expect(intent.record.status).toBe("requires_signature");
    expect(intent.record.paymentInfoHash).toBe(client.hash(paymentInfoFromJson(intent.record.paymentInfo)));

    const authorized = await service.submitSignature("esc_1", signature, { name: "USD Coin", version: "2" });
    expect(authorized.status).toBe("authorized");
    expect(chain.balanceOf(BASE_USDC, payerAccount.address)).toBe(75_000_000n);

    const partial = await service.capture("esc_1", 10_000_000n);
    expect(partial).toMatchObject({ status: "authorized", capturedAmount: "10000000" });
    const captured = await service.capture("esc_1");
    expect(captured).toMatchObject({ status: "captured", capturedAmount: "25000000" });
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(25_000_000n);

    // The operator funds refunds from its own balance.
    chain.mint(BASE_USDC, operatorAccount.address, 5_000_000n);
    const refunded = await service.refund("esc_1", 5_000_000n);
    expect(refunded).toMatchObject({ status: "partially_refunded", refundedAmount: "5000000" });
    expect(chain.balanceOf(BASE_USDC, payerAccount.address)).toBe(80_000_000n);
    expect(chain.txs.map((t) => t.functionName)).toEqual(["authorize", "capture", "capture", "approve", "refund"]);
    await expect(service.refund("esc_1", 30_000_000n)).rejects.toThrow(RangeError);
  });

  it("voids an uncaptured authorization back to the payer", async () => {
    const { chain, service, signature } = await escrowSetup();
    await service.submitSignature("esc_1", signature, { name: "USD Coin", version: "2" });
    const voided = await service.void("esc_1");
    expect(voided.status).toBe("voided");
    expect(chain.balanceOf(BASE_USDC, payerAccount.address)).toBe(100_000_000n);
    await expect(service.capture("esc_1")).rejects.toThrow(/voided/);
  });

  it("rejects a signature from anyone but the payer before touching the chain", async () => {
    const { chain, service, intent } = await escrowSetup();
    const forged = await operatorAccount.signTypedData(intent.typedData as never);
    await expect(service.submitSignature("esc_1", forged as Hex, { name: "USD Coin", version: "2" })).rejects.toThrow(/signature/);
    expect(chain.txs).toHaveLength(0);
  });

  it("charges in one step when autoCapture is set", async () => {
    const { chain, service } = await escrowSetup();
    const intent = await service.createIntent({
      id: "esc_2",
      organizationId: "org_1",
      payer: payerAccount.address,
      receiver: MERCHANT,
      token: BASE_USDC,
      amount: 3_000_000n,
      collector: "erc3009",
      autoCapture: true,
      tokenDomain: { name: "USD Coin", version: "2" },
    });
    const signature = await payerAccount.signTypedData(intent.typedData as never);
    const charged = await service.submitSignature("esc_2", signature, { name: "USD Coin", version: "2" });
    expect(charged).toMatchObject({ status: "captured", capturedAmount: "3000000" });
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(3_000_000n);
  });

  it("refuses PaymentInfo for another operator and chains without the deployment", () => {
    const clock = new Clock();
    const chain = baseChain(clock);
    const client = new CommerceEscrowClient(chain.operator(operatorAccount.address));
    const foreign: PaymentInfo = { ...sample, operator: payerAccount.address };
    return expect(client.void(foreign)).rejects.toThrow(/operator/);
  });

  it("returns payer calldata for pre-approval intents", async () => {
    const { service } = await escrowSetup();
    const intent = await service.createIntent({
      id: "esc_3",
      organizationId: "org_1",
      payer: payerAccount.address,
      receiver: MERCHANT,
      token: BASE_USDC,
      amount: 1_000_000n,
      collector: "pre_approval",
    });
    expect(intent.payerCalls).toHaveLength(2);
    expect(intent.typedData).toBeUndefined();
    expect(keccak256(toBytes(intent.record.paymentInfoHash))).toMatch(/^0x/);
  });
});
