import { describe, expect, it, vi } from "vitest";
import { maxUint256 } from "viem";
import type { CheckoutSession } from "@settlekit/common";
import type { EmailClient } from "@settlekit/notifications";
import { CommerceEscrowClient } from "../src/commerce-escrow.js";
import { EscrowPaymentService } from "../src/escrow-records.js";
import { RefundDispatcher, RefundUnsupportedError } from "../src/refund-dispatch.js";
import { RenewalInvoiceBilling } from "../src/renewal-invoice.js";
import { InMemoryOnchainBillingStore } from "../src/store.js";
import type { OnchainCharge } from "../src/types.js";
import { BASE_USDC, Clock, MERCHANT, T0, baseChain, operatorAccount, payerAccount, subscriptionFixture } from "./helpers.js";

class MemCheckouts {
  sessions = new Map<string, CheckoutSession>();
  async save(session: CheckoutSession) {
    this.sessions.set(session.id, session);
    return session;
  }
  async findById(id: string) {
    return this.sessions.get(id) ?? null;
  }
}

function mailer() {
  const send = vi.fn(async () => ({ id: "em_1" }));
  return { client: { from: "billing@settlekit.dev", send } as unknown as EmailClient, send };
}

const charge = (overrides: Partial<OnchainCharge> = {}): OnchainCharge => ({
  id: "och_1", onchainSubscriptionId: "osub_1", periodIndex: 2, network: "zcash", method: "renewal_invoice", amount: "25000000",
  status: "pending", attempt: 1, leaseUntil: T0.toISOString(), steps: [], createdAt: T0.toISOString(), updatedAt: T0.toISOString(), ...overrides,
});

describe("RenewalInvoiceBilling", () => {
  it("creates a renewal checkout session and emails the pay link", async () => {
    const checkouts = new MemCheckouts();
    const { client, send } = mailer();
    const clock = new Clock();
    const billing = new RenewalInvoiceBilling({ checkouts, email: client, checkoutBaseUrl: "https://pay.settlekit.dev/", merchantId: "mer_1", now: clock.now });
    const sub = subscriptionFixture({ network: "zcash", method: "renewal_invoice", amountDisplay: "25", grant: { kind: "renewal_invoice", email: "buyer@example.com" } });
    const outcome = await billing.collect(sub, { now: T0, charge: charge(), priorCollected: 0n, recordStep: async () => undefined });
    expect(outcome.status).toBe("awaiting_payment");
    const session = [...checkouts.sessions.values()][0]!;
    expect(session).toMatchObject({ network: "zcash", payToAddress: MERCHANT, amount: { amount: "25", currency: "USDC" }, status: "open" });
    expect(session.collectedFields).toEqual({ onchainSubscriptionId: "osub_1", periodIndex: "2" });
    const args = (send.mock.calls[0] as unknown as [{ to: string; text: string; html: string }])[0];
    expect(args.to).toBe("buyer@example.com");
    expect(args.text).toContain(`https://pay.settlekit.dev/c/${session.id}`);
    expect(args.html).not.toContain("<script");

    const pending = charge({ invoiceRef: session.id, status: "awaiting_payment" });
    expect(await billing.invoiceStatus(sub, pending)).toBe("open");
    // A retried charge re-sends the same session rather than creating another.
    await billing.collect(sub, { now: T0, charge: pending, priorCollected: 0n, recordStep: async () => undefined });
    expect(checkouts.sessions.size).toBe(1);
    await checkouts.save({ ...session, status: "completed" });
    expect(await billing.invoiceStatus(sub, pending)).toBe("paid");
    await checkouts.save({ ...session, status: "open" });
    clock.advanceSeconds(8 * 86_400);
    expect(await billing.invoiceStatus(sub, pending)).toBe("expired");
  });

  it("declines without an email on file", async () => {
    const billing = new RenewalInvoiceBilling({ checkouts: new MemCheckouts(), email: null, checkoutBaseUrl: "https://x", merchantId: "m" });
    await expect(
      billing.collect(subscriptionFixture({ method: "renewal_invoice", grant: undefined }), { now: T0, charge: charge(), priorCollected: 0n, recordStep: async () => undefined }),
    ).rejects.toThrow(/email/);
  });
});

describe("RefundDispatcher", () => {
  it("sends ERC-20 back to the payer from the operator on EVM chains", async () => {
    const clock = new Clock();
    const chain = baseChain(clock);
    const operator = chain.operator(operatorAccount.address);
    chain.mint(BASE_USDC, operatorAccount.address, 10_000_000n);
    const dispatcher = new RefundDispatcher({ evm: { base: { operator, token: BASE_USDC } } });
    const result = await dispatcher.refund({ network: "base", to: payerAccount.address, amount: 4_000_000n, reference: "ref_1" });
    expect(result.route).toBe("evm_transfer");
    expect(chain.balanceOf(BASE_USDC, payerAccount.address)).toBe(4_000_000n);
    chain.failNext("transfer", "revert");
    await expect(dispatcher.refund({ network: "base", to: payerAccount.address, amount: 1n, reference: "ref_2" })).rejects.toThrow(/reverted/);
  });

  it("refunds a Base escrow payment through AuthCaptureEscrow", async () => {
    const clock = new Clock();
    const chain = baseChain(clock);
    const operator = chain.operator(operatorAccount.address);
    const service = new EscrowPaymentService(new CommerceEscrowClient(operator), new InMemoryOnchainBillingStore(), clock.now);
    chain.mint(BASE_USDC, payerAccount.address, 20_000_000n);
    chain.mint(BASE_USDC, operatorAccount.address, 20_000_000n);
    chain.setErc20Allowance(BASE_USDC, operatorAccount.address, "0x7a03443724d14798c4AB4622F1DAAcA761Fea486", maxUint256);
    const intent = await service.createIntent({
      id: "esc_9", organizationId: "org_1", payer: payerAccount.address, receiver: MERCHANT, token: BASE_USDC, amount: 20_000_000n,
      collector: "erc3009", autoCapture: true, tokenDomain: { name: "USD Coin", version: "2" },
    });
    await service.submitSignature("esc_9", await payerAccount.signTypedData(intent.typedData as never), { name: "USD Coin", version: "2" });
    const dispatcher = new RefundDispatcher({ escrow: service });
    const result = await dispatcher.refund({ network: "base", to: payerAccount.address, amount: 20_000_000n, reference: "ref_3", escrowPaymentId: "esc_9" });
    expect(result.route).toBe("escrow_refund");
    expect(chain.balanceOf(BASE_USDC, payerAccount.address)).toBe(20_000_000n);
    // The allowance was already sufficient: no approve tx.
    expect(chain.txs.map((t) => t.functionName)).toEqual(["charge", "refund"]);
  });

  it("routes Solana and HyperCore to their senders and Zcash to manual", async () => {
    const solana = { settle: vi.fn(async () => ({ txHash: "solsig" })) };
    const hypercore = { usdSend: vi.fn(async () => ({ txHash: "0xhc" })) };
    const dispatcher = new RefundDispatcher({ solana, hypercore });
    expect(await dispatcher.refund({ network: "solana", to: "Buyer1111", amount: 1_500_000n, reference: "r1" })).toEqual({ route: "solana_transfer", txHash: "solsig" });
    expect(solana.settle).toHaveBeenCalledWith(expect.objectContaining({ amountUsdc: "1.5", network: "solana", reference: "refund:r1" }));
    expect(await dispatcher.refund({ network: "hypercore", to: "0xabc", amount: 2_000_000n, reference: "r2" })).toEqual({ route: "hypercore_usd_send", txHash: "0xhc" });
    expect(hypercore.usdSend).toHaveBeenCalledWith({ destination: "0xabc", amount: "2", reference: "r2" });
    await expect(dispatcher.refund({ network: "zcash", to: "t1abc", amount: 1n, reference: "r3" })).rejects.toThrow(RefundUnsupportedError);
    await expect(dispatcher.refund({ network: "base", to: "0x1", amount: 1n, reference: "r4" })).rejects.toThrow(RefundUnsupportedError);
    expect(new RefundDispatcher({}).routeFor("hypercore", false)).toBeNull();
    await expect(dispatcher.refund({ network: "solana", to: "x", amount: 0n, reference: "r5" })).rejects.toThrow(RangeError);
  });
});
