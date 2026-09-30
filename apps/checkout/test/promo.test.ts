/**
 * Promo codes on the hosted checkout: the discounted total becomes the
 * amount the on-chain verifier expects, and the redemption is counted once
 * after the payment confirms.
 */
import { describe, expect, it } from "vitest";
import { getEvmChain } from "@settlekit/chains";
import type { CouponStore } from "@settlekit/persistence";

import { CheckoutError } from "../lib/errors";
import { applyPromoCode } from "../lib/promo";
import { recordAndConfirm } from "../lib/store";
import { ORG, SESSION_CREATED, evmRuntime, fakeEvmRpc, harness, openSession, txHash, type FakeChainState, type Harness } from "./harness";

type Coupon = NonNullable<Awaited<ReturnType<CouponStore["findByCode"]>>>;
type Redemption = Parameters<CouponStore["recordRedemption"]>[0];

function memoryCoupons(seed: Coupon[]): CouponStore & { all: Map<string, Coupon>; redemptions: Redemption[] } {
  const all = new Map(seed.map((c) => [c.code, c]));
  const redemptions: Redemption[] = [];
  return {
    all,
    redemptions,
    async findByCode(code) {
      return all.get(code.trim().toUpperCase()) ?? null;
    },
    async save(coupon) {
      all.set(coupon.code, coupon);
      return coupon;
    },
    async list() {
      return [...all.values()];
    },
    async recordRedemption(r) {
      redemptions.push(r);
      return r;
    },
    async redemptionsByCustomer(code) {
      const counts: Record<string, number> = {};
      for (const r of redemptions) if (r.couponCode === code && r.customerId) counts[r.customerId] = (counts[r.customerId] ?? 0) + 1;
      return counts;
    },
  };
}

const BASE = getEvmChain("base", "mainnet")!;
const AT = new Date(SESSION_CREATED.getTime() + 60_000);

function setup(): { h: Harness; chain: FakeChainState; coupons: ReturnType<typeof memoryCoupons> } {
  const chain: FakeChainState = { chainId: BASE.chainId, token: BASE.token.address, head: 102n, txs: {} };
  const evm = evmRuntime({ SETTLEKIT_CHAIN_ENV: "mainnet", ENABLED_EVM_CHAINS: "base" }, { base: fakeEvmRpc(chain) });
  const coupons = memoryCoupons([
    { code: "LAUNCH20", organizationId: ORG, discount: { type: "percent", percentOff: 20 }, currency: "USDC", status: "active", redeemedCount: 0 },
    { code: "ELSEWHERE", organizationId: "org_other", discount: { type: "percent", percentOff: 50 }, currency: "USDC", status: "active", redeemedCount: 0 },
  ]);
  const base = harness({ evm });
  const h: Harness = { ...base, deps: { ...base.deps, backend: { ...base.deps.backend, coupons } } };
  return { h, chain, coupons };
}

async function code(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CheckoutError);
  return (error as CheckoutError).message;
}

describe("checkout promo codes", () => {
  it("discounts the session and settles at the discounted amount, counting the code once", async () => {
    const { h, chain, coupons } = setup();
    const session = await openSession(h, "base");
    const discounted = await applyPromoCode(session.id, "launch20", h.deps, AT);
    expect(discounted.amount.amount).toBe("20");
    expect(discounted.discount).toMatchObject({ couponCode: "LAUNCH20", subtotal: { amount: "25" }, amountOff: { amount: "5" } });

    // A second code is refused.
    expect(await code(applyPromoCode(session.id, "LAUNCH20", h.deps, AT))).toMatch(/already applied/);

    chain.txs[txHash(7)] = { transfers: [{ amountBase: 20_000_000n }] };
    const { payment, session: completed } = await recordAndConfirm(session.id, txHash(7), h.deps);
    expect(payment.amount.amount).toBe("20");
    expect(completed.status).toBe("completed");
    expect(coupons.all.get("LAUNCH20")?.redeemedCount).toBe(1);
    expect(coupons.redemptions).toHaveLength(1);
    expect((await h.checkouts.findById(session.id))?.discount?.redeemedAt).toBeDefined();

    // Idempotent re-confirm does not count again.
    await recordAndConfirm(session.id, txHash(7), h.deps);
    expect(coupons.all.get("LAUNCH20")?.redeemedCount).toBe(1);
  });

  it("refuses unknown, foreign and malformed codes, invoices, and sessions with a recorded payment", async () => {
    const { h, chain } = setup();
    const session = await openSession(h, "base");
    expect(await code(applyPromoCode(session.id, "NOPE", h.deps, AT))).toMatch(/not valid/);
    expect(await code(applyPromoCode(session.id, "ELSEWHERE", h.deps, AT))).toMatch(/not valid/);
    expect(await code(applyPromoCode(session.id, "<script>", h.deps, AT))).toMatch(/valid promo/);

    const invoice = await openSession(h, "base", { invoiceId: "inv_1" });
    expect(await code(applyPromoCode(invoice.id, "LAUNCH20", h.deps, AT))).toMatch(/invoices/);

    // Once a payment is claimed the price is fixed.
    chain.txs[txHash(9)] = { transfers: [{ amountBase: 25_000_000n }] };
    await recordAndConfirm(session.id, txHash(9), h.deps);
    expect(await code(applyPromoCode(session.id, "LAUNCH20", h.deps, AT))).toMatch(/already been paid/);
  });

  it("is unavailable without a coupon store", async () => {
    const plain = harness();
    const session = await openSession(plain, "base");
    expect(await code(applyPromoCode(session.id, "LAUNCH20", plain.deps, AT))).toMatch(/not available/);
  });
});
