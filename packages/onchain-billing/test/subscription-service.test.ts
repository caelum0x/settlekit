import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, maxUint256, type Hex } from "viem";
import { generateKeyPairSigner } from "@solana/kit";
import { DunningService, InMemoryDunningStore } from "@settlekit/dunning";
import { USDC_MINT_DEVNET } from "@settlekit/solana";
import type { CheckoutSession } from "@settlekit/common";
import { permit2Abi } from "../src/abis.js";
import { PERMIT2_ADDRESS } from "../src/addresses.js";
import { buildOnchainBilling } from "../src/runtime.js";
import { ownerTokenAccount, type SplDelegateRpc, type SplTokenAccount } from "../src/spl-delegate.js";
import { InMemoryOnchainBillingStore } from "../src/store.js";
import { FakeEvm } from "./fake-evm.js";
import { ARB_USDC, BASE_USDC, Clock, MERCHANT, OPERATOR_KEY, T0, payerAccount } from "./helpers.js";

const HYPER_USDC = getAddress("0xb88339CB7199b77E23DB6E890353E22632Ba630f");
const BUYER_SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

class FakeSpl implements SplDelegateRpc {
  accounts = new Map<string, SplTokenAccount>();
  async getTokenAccount(a: string) {
    return this.accounts.get(a) ?? null;
  }
  async getLatestBlockhash() {
    return { blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k", lastValidBlockHeight: 10n };
  }
  async sendTransaction() {
    return "sig";
  }
  async getSignatureStatuses(s: readonly string[]) {
    return s.map(() => ({ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" as const }));
  }
}

async function runtime(extraEnv: Record<string, string> = {}) {
  const clock = new Clock();
  const chains = new Map<number, FakeEvm>();
  const store = new InMemoryOnchainBillingStore();
  const sessions = new Map<string, CheckoutSession>();
  const spl = new FakeSpl();
  const solSigner = await generateKeyPairSigner();
  const built = await buildOnchainBilling({
    env: {
      SETTLEKIT_CHAIN_ENV: "mainnet",
      ENABLED_EVM_CHAINS: "base,arbitrum,hyperevm",
      ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY: OPERATOR_KEY,
      ONCHAIN_BILLING_CHECKOUT_URL: "https://pay.example",
      SOLANA_CLUSTER: "devnet",
      ...extraEnv,
    },
    store,
    dunning: new DunningService(new InMemoryDunningStore(), clock.now),
    checkouts: { save: async (s) => (sessions.set(s.id, s), s), findById: async (id) => sessions.get(id) ?? null },
    email: null,
    merchantId: "mer_1",
    now: clock.now,
    evmOperatorFactory: (chainId, _rpc, _key, token) => {
      const chain = new FakeEvm(chainId, {}, BigInt(Math.floor(T0.getTime() / 1000)));
      chains.set(chainId, chain);
      chain.mint(token, payerAccount.address, 100_000_000n);
      chain.setErc20Allowance(token, payerAccount.address, PERMIT2_ADDRESS, maxUint256);
      return chain.operator(getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"));
    },
    splRpc: spl,
    solanaSigner: solSigner,
    solanaRefunds: { settle: async () => ({ txHash: "solsig" }) },
  });
  if (!built) throw new Error("runtime not built");
  return { built, chains, store, clock, spl, solSigner, sessions };
}

const baseIntent = {
  organizationId: "org_1",
  customerId: "cus_1",
  productId: "prod_1",
  priceId: "price_1",
  subscriptionId: "sub_1",
  payTo: MERCHANT,
  amount: "9.99",
  interval: "monthly" as const,
};

describe("buildOnchainBilling + OnchainSubscriptionService", () => {
  it("offers only the methods each network really supports", async () => {
    const { built } = await runtime();
    const s = built.subscriptions;
    expect(s.methodsFor("base")).toEqual(["spend_permission", "permit2", "renewal_invoice"]);
    expect(s.methodsFor("arbitrum")).toEqual(["spend_permission", "permit2", "renewal_invoice"]);
    expect(s.methodsFor("hyperevm")).toEqual(["permit2", "renewal_invoice"]);
    expect(s.methodsFor("solana")).toEqual(["spl_delegate", "renewal_invoice"]);
    expect(s.methodsFor("hypercore")).toEqual(["renewal_invoice"]);
    expect(s.methodsFor("zcash")).toEqual(["renewal_invoice"]);
    expect(s.methodsFor("ethereum")).toEqual(["renewal_invoice"]);
    expect(built.escrow).not.toBeNull();
    expect(built.notes.join(" ")).toMatch(/HyperCore refunds are manual/);
    await expect(s.createIntent({ ...baseIntent, id: "x", network: "hyperevm", method: "spend_permission", payer: payerAccount.address })).rejects.toThrow(/not available/);
  });

  it("Permit2 on HyperEVM: intent -> signed grant -> first period charged", async () => {
    const { built, chains, store } = await runtime();
    const intent = await built.subscriptions.createIntent({ ...baseIntent, id: "osub_h", network: "hyperevm", method: "permit2", payer: payerAccount.address });
    expect(intent.subscription).toMatchObject({ status: "pending_grant", token: HYPER_USDC, amountPerPeriod: "9990000", periodsCovered: 12 });
    expect(intent.action.kind).toBe("sign_typed_data");
    const typed = (intent.action as { typedData: never }).typedData;
    const active = await built.subscriptions.submitGrant("osub_h", { signature: await payerAccount.signTypedData(typed) });
    expect(active.status).toBe("active");
    expect(active.intent).toBeUndefined();
    expect(await built.engine.chargeSubscription("osub_h")).toBe("succeeded");
    expect(chains.get(999)!.balanceOf(HYPER_USDC, MERCHANT)).toBe(9_990_000n);
    expect((await store.listCharges("osub_h"))[0]).toMatchObject({ status: "succeeded", periodIndex: 0 });

    const canceled = await built.subscriptions.cancel("osub_h");
    expect(canceled.subscription.cancelAtPeriodEnd).toBe(true);
    const call = (canceled.buyerRevoke as { payerCalls: Array<{ data: Hex; to: string }> }).payerCalls[0]!;
    expect(call.to).toBe(PERMIT2_ADDRESS);
    expect(decodeFunctionData({ abi: permit2Abi, data: call.data }).args).toEqual([HYPER_USDC, getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"), 0n, 0]);
    await expect(built.subscriptions.submitGrant("osub_h", { signature: "0x" })).rejects.toThrow(/active/);
  });

  it("Spend permission on Base: smart-wallet grant, charge, and operator-side revoke on cancel", async () => {
    const { built, chains } = await runtime();
    const intent = await built.subscriptions.createIntent({ ...baseIntent, id: "osub_b", network: "base", method: "spend_permission", payer: payerAccount.address });
    const typed = (intent.action as { typedData: never }).typedData;
    await built.subscriptions.submitGrant("osub_b", { signature: await payerAccount.signTypedData(typed) });
    expect(await built.engine.chargeSubscription("osub_b")).toBe("succeeded");
    expect(chains.get(8453)!.balanceOf(BASE_USDC, MERCHANT)).toBe(9_990_000n);
    const canceled = await built.subscriptions.cancel("osub_b", false);
    expect(canceled.subscription.status).toBe("canceled");
    expect(canceled.operatorRevokeTx).toMatch(/^0x/);
    expect(await built.engine.chargeSubscription("osub_b")).toBe("not_due");
  });

  it("SPL delegate on Solana: returns the approve tx, then verifies the delegation", async () => {
    const { built, spl, solSigner } = await runtime();
    const intent = await built.subscriptions.createIntent({ ...baseIntent, id: "osub_s", network: "solana", method: "spl_delegate", payer: BUYER_SOL, payTo: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr" });
    expect(intent.action).toMatchObject({ kind: "send_transaction", encoding: "base64", network: "solana" });
    expect(intent.subscription.token).toBe(USDC_MINT_DEVNET);
    const ata = await ownerTokenAccount(BUYER_SOL, USDC_MINT_DEVNET);
    spl.accounts.set(ata, { mint: USDC_MINT_DEVNET, owner: BUYER_SOL, amount: 50_000_000n, delegate: solSigner.address, delegatedAmount: 119_880_000n });
    const active = await built.subscriptions.submitGrant("osub_s", { approveSignature: "approve-sig" });
    expect(active.grant).toMatchObject({ kind: "spl_delegate", delegate: solSigner.address, tokenAccount: ata });
    await expect(built.subscriptions.submitGrant("osub_x", {})).rejects.toThrow(/not found/);
  });

  it("renewal invoices on HyperCore need only an email", async () => {
    const { built, sessions } = await runtime();
    await expect(built.subscriptions.createIntent({ ...baseIntent, id: "osub_n", network: "hypercore", method: "renewal_invoice" })).rejects.toThrow(/email/);
    const intent = await built.subscriptions.createIntent({ ...baseIntent, id: "osub_hc", network: "hypercore", method: "renewal_invoice", email: "b@example.com" });
    expect(intent.action).toEqual({ kind: "none" });
    await built.subscriptions.submitGrant("osub_hc", {});
    expect(await built.engine.chargeSubscription("osub_hc")).toBe("awaiting_payment");
    expect([...sessions.values()][0]).toMatchObject({ network: "hypercore", amount: { amount: "9.99" } });
  });

  it("returns null when nothing can bill, and validates the operator key", async () => {
    const base = {
      store: new InMemoryOnchainBillingStore(),
      dunning: new DunningService(new InMemoryDunningStore()),
      checkouts: { save: async (s: CheckoutSession) => s, findById: async () => null },
      email: null,
      merchantId: "m",
    };
    expect(await buildOnchainBilling({ ...base, env: {} })).toBeNull();
    await expect(buildOnchainBilling({ ...base, env: { ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY: "0x1234" } })).rejects.toThrow(/32-byte/);
  });

  it("rejects out-of-range periods and amounts", async () => {
    const { built } = await runtime();
    await expect(built.subscriptions.createIntent({ ...baseIntent, id: "p", network: "base", method: "permit2", payer: payerAccount.address, periods: 0 })).rejects.toThrow(/periods/);
    await expect(built.subscriptions.createIntent({ ...baseIntent, id: "p", network: "base", method: "permit2", payer: payerAccount.address, amount: "0" })).rejects.toThrow(/positive/);
    await expect(built.subscriptions.createIntent({ ...baseIntent, id: "p", network: "base", method: "permit2" })).rejects.toThrow(/payer/);
    void ARB_USDC;
  });
});
