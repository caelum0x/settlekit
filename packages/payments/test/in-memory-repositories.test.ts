import { describe, it, expect } from "vitest";
import {
  createInMemoryPaymentStores,
  createCheckoutSession,
  recordPendingPayment,
  confirmPayment,
  createSubscription,
} from "../src/index.js";
import { makePrice, makeItem, USDC } from "./helpers.js";

const NOW = new Date("2026-06-15T00:00:00.000Z");

describe("in-memory repositories", () => {
  it("saves and finds a checkout session by id and customer", async () => {
    const { checkouts } = createInMemoryPaymentStores();
    const session = createCheckoutSession(
      {
        organizationId: "org_1",
        merchantId: "mch_1",
        customerId: "cus_1",
        items: [makeItem(makePrice())],
        payToAddress: "0xabc",
        network: "arc",
      },
      NOW,
    );
    await checkouts.save(session);
    expect(await checkouts.findById(session.id)).toEqual(session);
    const forCustomer = await checkouts.findByCustomerId("cus_1");
    expect(forCustomer).toHaveLength(1);
    expect(forCustomer[0]!.id).toBe(session.id);
  });

  it("returns null for a missing id", async () => {
    const { payments } = createInMemoryPaymentStores();
    expect(await payments.findById("pay_missing")).toBeNull();
  });

  it("does not let callers mutate the stored entity via references", async () => {
    const { checkouts } = createInMemoryPaymentStores();
    const session = createCheckoutSession(
      {
        organizationId: "org_1",
        merchantId: "mch_1",
        items: [makeItem(makePrice())],
        payToAddress: "0xabc",
        network: "arc",
      },
      NOW,
    );
    await checkouts.save(session);
    const fetched = await checkouts.findById(session.id);
    fetched!.status = "canceled";
    const refetched = await checkouts.findById(session.id);
    expect(refetched!.status).toBe("open");
  });

  it("indexes payments by checkout session and tx hash", async () => {
    const { payments } = createInMemoryPaymentStores();
    const pending = recordPendingPayment(
      {
        organizationId: "org_1",
        checkoutSessionId: "cs_1",
        customerId: "cus_1",
        amount: USDC("25"),
        network: "arc",
      },
      NOW,
    );
    await payments.save(pending);
    const confirmed = confirmPayment(pending, "0xhash", 3, 1, NOW);
    await payments.save(confirmed);

    expect((await payments.findById(confirmed.id))!.status).toBe("confirmed");
    expect(await payments.findByTxHash("0xhash")).not.toBeNull();
    expect(await payments.findByTxHash("0xmissing")).toBeNull();
    const bySession = await payments.findByCheckoutSessionId("cs_1");
    expect(bySession).toHaveLength(1);
  });

  it("saves and finds subscriptions by customer", async () => {
    const { subscriptions } = createInMemoryPaymentStores();
    const sub = createSubscription(
      {
        organizationId: "org_1",
        customerId: "cus_1",
        productId: "prod_1",
        price: makePrice({ interval: "monthly" }),
      },
      NOW,
    );
    await subscriptions.save(sub);
    expect(subscriptions.size()).toBe(1);
    const found = await subscriptions.findByCustomerId("cus_1");
    expect(found[0]!.id).toBe(sub.id);
  });
});
