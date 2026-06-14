import { addMoney, money, type Money } from "@settlekit/common";

export function sumBundleItemPrices(prices: Money[]): Money {
  return prices.reduce((total, price) => addMoney(total, price), money("0"));
}
