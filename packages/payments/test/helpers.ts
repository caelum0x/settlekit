import { money, type Price } from "@settlekit/common";
import type { PricedLineItem } from "../src/index.js";

let seq = 0;

/** Build a Price for tests. */
export function makePrice(overrides: Partial<Price> = {}): Price {
  seq += 1;
  return {
    id: `price_test_${seq}`,
    productId: `prod_test_${seq}`,
    amount: "10",
    currency: "USDC",
    interval: "one_time",
    usageBased: false,
    active: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

/** Build a priced line item for checkout tests. */
export function makeItem(
  price: Price,
  quantity = 1,
): PricedLineItem {
  return {
    lineItem: { priceId: price.id, productId: price.productId, quantity },
    price,
  };
}

export const USDC = (amount: string) => money(amount, "USDC");
