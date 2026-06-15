import type { Entitlement, Payment, Product, Subscription } from "@settlekit/common";

export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay_test_1",
    organizationId: "org_test_1",
    checkoutSessionId: "cs_test_1",
    customerId: "cus_test_1",
    amount: { amount: "10.000000", currency: "USDC" },
    network: "arc",
    confirmations: 3,
    status: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
    confirmedAt: "2026-01-01T00:00:05.000Z",
    ...overrides,
  };
}

export function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_test_1",
    organizationId: "org_test_1",
    customerId: "cus_test_1",
    productId: "prod_test_1",
    priceId: "price_test_1",
    status: "active",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod_test_1",
    merchantId: "mch_test_1",
    organizationId: "org_test_1",
    name: "Pro Plan",
    description: "The pro plan",
    type: "saas_plan",
    status: "active",
    deliveryMode: "saas_entitlement",
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeEntitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    id: "ent_test_1",
    organizationId: "org_test_1",
    customerId: "cus_test_1",
    productId: "prod_test_1",
    grantedBy: { type: "payment", id: "pay_test_1" },
    entitlementType: "saas_feature",
    status: "active",
    features: { ai_export: true, max_projects: 10 },
    creditsRemaining: 20,
    seats: 5,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
