import { money } from "@settlekit/common";

export function validateAgentPrice(price: string): string {
  return money(price).amount;
}
