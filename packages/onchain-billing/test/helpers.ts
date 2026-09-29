import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { DunningService, InMemoryDunningStore } from "@settlekit/dunning";
import type { Hex } from "@settlekit/chains";
import { InMemoryOnchainBillingStore } from "../src/store.js";
import type { OnchainSubscription } from "../src/types.js";
import { FakeEvm } from "./fake-evm.js";

// Well-known anvil development keys (never funded on mainnet).
export const OPERATOR_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
export const PAYER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
export const OTHER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;
export const operatorAccount = privateKeyToAccount(OPERATOR_KEY);
export const payerAccount = privateKeyToAccount(PAYER_KEY);
export const otherAccount = privateKeyToAccount(OTHER_KEY);
export const MERCHANT = getAddress("0x1111111111111111111111111111111111111111");
export const BASE_USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
export const ARB_USDC = getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");

export const T0 = new Date("2030-03-17T12:00:00.000Z");
export const MONTH = 30 * 86_400;

export class Clock {
  constructor(public current: Date = T0) {}
  now = (): Date => this.current;
  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

export function baseChain(clock: Clock): FakeEvm {
  const chain = new FakeEvm(8453, { [BASE_USDC.toLowerCase()]: { name: "USD Coin", version: "2" } });
  chain.blockTime = BigInt(Math.floor(clock.now().getTime() / 1000));
  return chain;
}

/** Keep the fake chain's block time in step with the test clock. */
export function syncChain(chain: FakeEvm, clock: Clock): void {
  chain.blockTime = BigInt(Math.floor(clock.now().getTime() / 1000));
}

export function billingDeps(clock: Clock) {
  const store = new InMemoryOnchainBillingStore();
  const dunning = new DunningService(new InMemoryDunningStore(), clock.now);
  return { store, dunning };
}

export function subscriptionFixture(overrides: Partial<OnchainSubscription> = {}): OnchainSubscription {
  return {
    id: "osub_1",
    organizationId: "org_1",
    customerId: "cus_1",
    productId: "prod_1",
    priceId: "price_1",
    subscriptionId: "sub_1",
    network: "base",
    method: "permit2",
    payer: payerAccount.address,
    payTo: MERCHANT,
    token: BASE_USDC,
    decimals: 6,
    amountPerPeriod: "9990000",
    amountDisplay: "9.99",
    periodSeconds: MONTH,
    periodsCovered: 12,
    anchorAt: T0.toISOString(),
    paidThrough: -1,
    status: "active",
    cancelAtPeriodEnd: false,
    createdAt: T0.toISOString(),
    updatedAt: T0.toISOString(),
    ...overrides,
  };
}

export const operatorAddress: Hex = operatorAccount.address;
