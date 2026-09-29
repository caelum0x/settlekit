/**
 * Optional Base-fork integration test against the REAL audited contracts.
 * Skipped unless FORK_RPC_URL points at an anvil fork of Base mainnet, e.g.
 *   anvil --fork-url https://mainnet.base.org --port 8545
 *   FORK_RPC_URL=http://127.0.0.1:8545 pnpm vitest run packages/onchain-billing/test/fork.test.ts
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, encodeAbiParameters, getAddress, http, keccak256, maxUint256, numberToHex, pad, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import deployments from "./fixtures/deployments.json" with { type: "json" };
import { authCaptureEscrowAbi, erc20Abi, spendPermissionManagerAbi } from "../src/abis.js";
import { COMMERCE_PAYMENTS_V1_1, PERMIT2_ADDRESS, SPEND_PERMISSION_MANAGER } from "../src/addresses.js";
import { CommerceEscrowClient, hashPaymentInfo, paymentInfoFromJson } from "../src/commerce-escrow.js";
import { EscrowPaymentService } from "../src/escrow-records.js";
import { createViemOperator } from "../src/evm.js";
import { Permit2Billing } from "../src/permit2-allowance.js";
import { hashSpendPermission, spendPermissionFromJson } from "../src/spend-permission.js";
import { InMemoryOnchainBillingStore } from "../src/store.js";
import type { OnchainCharge } from "../src/types.js";
import { subscriptionFixture } from "./helpers.js";

const FORK = process.env.FORK_RPC_URL;
// Fresh keys per run: the public anvil dev accounts carry EIP-7702 delegations
// on Base mainnet, which turns their signatures into ERC-1271 checks.
const OPERATOR_KEY = generatePrivateKey();
const PAYER_KEY = generatePrivateKey();
const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const MERCHANT = getAddress("0x2222222222222222222222222222222222222222");

async function anvil(rpc: string, method: string, params: unknown[]): Promise<void> {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
}

async function fundUsdc(rpc: string, holder: Hex, amount: bigint): Promise<void> {
  // FiatToken balances mapping lives at slot 9.
  const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 9n]));
  await anvil(rpc, "anvil_setStorageAt", [USDC, slot, pad(numberToHex(amount), { size: 32 })]);
}

describe.skipIf(!FORK)("Base fork: real commerce-payments, SpendPermissionManager and Permit2", () => {
  const rpc = FORK ?? "http://127.0.0.1:8545";
  const operator = createViemOperator({ chainId: 8453, rpcUrl: rpc, privateKey: OPERATOR_KEY });
  const payer = privateKeyToAccount(PAYER_KEY);
  const payerWallet = createWalletClient({ account: payer, chain: { ...base, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) });
  const reader = createPublicClient({ chain: base, transport: http(rpc) });

  beforeAll(async () => {
    for (const address of [operator.address, payer.address]) await anvil(rpc, "anvil_setBalance", [address, numberToHex(10n ** 18n)]);
  });

  it("our hashes equal the deployed contracts' getHash", async () => {
    const info = paymentInfoFromJson(deployments.samples.paymentInfo);
    const onchain = await operator.read<Hex>({ address: COMMERCE_PAYMENTS_V1_1.authCaptureEscrow, abi: authCaptureEscrowAbi, functionName: "getHash", args: [info] });
    expect(onchain).toBe(hashPaymentInfo(info, 8453));
    const permission = spendPermissionFromJson(deployments.samples.spendPermission);
    const spm = await operator.read<Hex>({ address: SPEND_PERMISSION_MANAGER, abi: spendPermissionManagerAbi, functionName: "getHash", args: [permission] });
    expect(spm).toBe(hashSpendPermission(8453, permission));
  });

  it("Permit2 subscription: permit() + one transferFrom per period against real Permit2 and USDC", async () => {
    await fundUsdc(rpc, payer.address, 50_000_000n);
    const approve = await payerWallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [PERMIT2_ADDRESS, maxUint256] });
    await reader.waitForTransactionReceipt({ hash: approve });
    const billing = new Permit2Billing([operator]);
    const now = new Date(Number(await operator.blockTimestamp()) * 1000);
    const intent = await billing.createIntent(8453, { owner: payer.address, token: USDC, amountPerPeriod: 1_000_000n, periods: 3, anchor: now, periodSeconds: 2_592_000, now });
    const signature = await payer.signTypedData(intent.typedData as never);
    const grant = await billing.acceptGrant(
      {
        kind: "permit2", chainId: 8453, owner: payer.address, token: USDC, spender: operator.address,
        amount: intent.permit.details.amount.toString(), expiration: intent.permit.details.expiration, nonce: intent.permit.details.nonce,
        sigDeadline: intent.permit.sigDeadline.toString(), signature,
      },
      now,
    );
    const before = await reader.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [MERCHANT] });
    const charge: OnchainCharge = {
      id: "och_fork", onchainSubscriptionId: "osub_fork", periodIndex: 0, network: "base", method: "permit2", amount: "1000000",
      status: "pending", attempt: 1, leaseUntil: now.toISOString(), steps: [], createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const outcome = await billing.collect(subscriptionFixture({ grant, payTo: MERCHANT, amountPerPeriod: "1000000" }), {
      now, charge, priorCollected: 0n, recordStep: async () => undefined,
    });
    expect(outcome.status).toBe("succeeded");
    const after = await reader.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [MERCHANT] });
    expect(after - before).toBe(1_000_000n);
  });

  it("escrow: ERC-3009 authorize, capture and operator refund on the real AuthCaptureEscrow", async () => {
    await fundUsdc(rpc, payer.address, 50_000_000n);
    await fundUsdc(rpc, operator.address, 50_000_000n);
    const clockFromChain = new Date(Number(await operator.blockTimestamp()) * 1000);
    const service = new EscrowPaymentService(new CommerceEscrowClient(operator), new InMemoryOnchainBillingStore(), () => clockFromChain);
    const intent = await service.createIntent({
      id: "esc_fork", organizationId: "org", payer: payer.address, receiver: MERCHANT, token: USDC, amount: 2_000_000n,
      collector: "erc3009", tokenDomain: { name: "USD Coin", version: "2" },
    });
    const signature = await payer.signTypedData(intent.typedData as never);
    await service.submitSignature("esc_fork", signature, { name: "USD Coin", version: "2" });
    const captured = await service.capture("esc_fork");
    expect(captured.status).toBe("captured");
    const refunded = await service.refund("esc_fork", 500_000n);
    expect(refunded).toMatchObject({ status: "partially_refunded", refundedAmount: "500000" });
  });
});
