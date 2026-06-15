/**
 * Tiny, real construction helpers shared across the examples. These build
 * fully-typed @settlekit/common domain values (no mocks) so each example can
 * focus on the package interaction it demonstrates.
 */
import { generateId, toIso } from "@settlekit/common";
import type {
  Money,
  Payment,
  Product,
  ProductType,
  DeliveryMode,
} from "@settlekit/common";

/** A confirmed USDC payment ready to grant entitlements from. */
export function confirmedPayment(input: {
  organizationId: string;
  customerId: string;
  amount: Money;
  now?: Date;
}): Payment {
  const now = input.now ?? new Date();
  const iso = toIso(now);
  return {
    id: generateId("payment"),
    organizationId: input.organizationId,
    checkoutSessionId: generateId("checkoutSession"),
    customerId: input.customerId,
    amount: input.amount,
    network: "arc",
    txHash: `0x${"a1".repeat(32)}`,
    confirmations: 12,
    status: "confirmed",
    createdAt: iso,
    confirmedAt: iso,
  };
}

/** An active product of the given type. */
export function activeProduct(input: {
  organizationId: string;
  merchantId: string;
  name: string;
  type: ProductType;
  deliveryMode: DeliveryMode;
  metadata?: Record<string, unknown>;
  now?: Date;
}): Product {
  const now = input.now ?? new Date();
  const iso = toIso(now);
  return {
    id: generateId("product"),
    merchantId: input.merchantId,
    organizationId: input.organizationId,
    name: input.name,
    description: `${input.name} (example fixture)`,
    type: input.type,
    status: "active",
    deliveryMode: input.deliveryMode,
    metadata: input.metadata ?? {},
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Convenience for a USDC money value. */
export function usdc(amount: string): Money {
  return { amount, currency: "USDC" };
}
