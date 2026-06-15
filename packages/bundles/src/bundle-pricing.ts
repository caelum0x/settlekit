import type { Currency, Money } from "@settlekit/common";
import { addMoney, money } from "@settlekit/common";

/** Input for {@link resolveBundlePrice}. */
export interface ResolveBundlePriceInput {
  /** Fixed override price. When present it wins over the summed member prices. */
  override?: Money;
  /** Per-member list prices to sum when no override is given. */
  memberPrices: Money[];
}

/**
 * Sum a list of member prices. All prices must share a currency; an empty list
 * yields zero USDC. Never mutates its inputs.
 */
export function sumBundleItemPrices(prices: Money[]): Money {
  if (prices.length === 0) {
    return money("0");
  }
  const currency: Currency = prices[0]!.currency;
  return prices.reduce<Money>((total, price) => {
    if (price.currency !== currency) {
      throw new Error(
        `bundle pricing: mixed currencies (${currency} vs ${price.currency})`,
      );
    }
    return addMoney(total, price);
  }, money("0", currency));
}

/**
 * Resolve the effective price of a bundle. A fixed `override` always wins;
 * otherwise the price is the sum of member list prices.
 */
export function resolveBundlePrice(input: ResolveBundlePriceInput): Money {
  if (input.override) {
    return { ...input.override };
  }
  return sumBundleItemPrices(input.memberPrices);
}
