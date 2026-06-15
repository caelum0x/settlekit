import { money, multiplyMoney, type Money } from "@settlekit/common";

/**
 * Per-request pricing helpers for agent services.
 *
 * Agent services charge per call (x402). Prices are USDC amounts; we reuse the
 * common `Money` primitive so all arithmetic stays in integer base units.
 */

/** Validate and normalize a per-request price string (USDC, <=6dp). Throws on invalid input. */
export function validateAgentPrice(price: string): string {
  return money(price).amount;
}

/** The per-request price of a service as a `Money` value. */
export function agentRequestPrice(price: string): Money {
  return money(price);
}

/** Total cost of `requests` calls at the given per-request price. */
export function agentUsageCost(price: string, requests: number): Money {
  if (!Number.isInteger(requests) || requests < 0) {
    throw new RangeError(`requests must be a non-negative integer, got ${requests}`);
  }
  return multiplyMoney(money(price), requests);
}
