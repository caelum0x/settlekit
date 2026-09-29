/**
 * Deployed contract addresses used for onchain billing.
 *
 * Every address below was checked on 2026-09-29 with `eth_getCode` against the
 * public RPCs in `@settlekit/chains` (bytecode sizes are recorded in
 * test/fixtures/deployments.json and asserted by the tests):
 *
 *  - base/commerce-payments v1.1.0 (MIT, audited by Spearbit + Coinbase
 *    Protocol Security): CREATE2-deployed, identical on Base mainnet (8453)
 *    and Base Sepolia (84532). Source: github.com/base/commerce-payments README.
 *  - Base Account SpendPermissionManager (coinbase/spend-permissions, MIT):
 *    deployed on Ethereum, Base, Arbitrum One, Robinhood Chain, Sepolia and
 *    Base Sepolia. NOT on HyperEVM, Tempo, Arbitrum Sepolia or Robinhood testnet.
 *  - Uniswap Permit2: deployed on every SettleKit EVM chain, both environments.
 */
import type { Hex } from "@settlekit/chains";

/** base/commerce-payments v1.1.0 deployment (same address on 8453 and 84532). */
export const COMMERCE_PAYMENTS_V1_1 = {
  authCaptureEscrow: "0xf96815976523E00e65Be8f34cA5e64b4f41EB19c",
  erc3009PaymentCollector: "0x8612dfdc421f80336cd14E8EF9cb1E765dB5ab88",
  permit2PaymentCollector: "0xD69831Aed5bfe262067ec4c751f4F830EcdD446e",
  preApprovalPaymentCollector: "0xF1F9C408C787B2bC6CAEB91e5BbEc434a5c8d2Ea",
  spendPermissionPaymentCollector: "0xB508c1C0a13849693DC175307667653C5977a408",
  operatorRefundCollector: "0x7a03443724d14798c4AB4622F1DAAcA761Fea486",
} as const satisfies Record<string, Hex>;

export type CommercePaymentsContracts = { readonly [K in keyof typeof COMMERCE_PAYMENTS_V1_1]: Hex };

/** Chain ids where commerce-payments v1.1.0 is deployed (and audited for). */
export const COMMERCE_PAYMENTS_CHAIN_IDS: readonly number[] = [8453, 84532];

/** Base Account SpendPermissionManager (same address everywhere it exists). */
export const SPEND_PERMISSION_MANAGER: Hex = "0xf85210B21cC50302F477BA56686d2019dC9b67Ad";

/** Chain ids where SpendPermissionManager bytecode was observed. */
export const SPEND_PERMISSION_CHAIN_IDS: readonly number[] = [1, 8453, 42161, 4663, 11155111, 84532];

/** Uniswap Permit2 (canonical CREATE2 address). */
export const PERMIT2_ADDRESS: Hex = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/** Chain ids where Permit2 bytecode was observed. */
export const PERMIT2_CHAIN_IDS: readonly number[] = [
  1, 8453, 42161, 4663, 999, 4217, 11155111, 84532, 421614, 46630, 998, 42431,
];

/** Multicall3 (used by the collectors' ERC-6492 handler). */
export const MULTICALL3_ADDRESS: Hex = "0xcA11bde05977b3631167028862bE2a173976CA11";

export function commercePaymentsFor(chainId: number): CommercePaymentsContracts | undefined {
  return COMMERCE_PAYMENTS_CHAIN_IDS.includes(chainId) ? COMMERCE_PAYMENTS_V1_1 : undefined;
}

export function hasSpendPermissionManager(chainId: number): boolean {
  return SPEND_PERMISSION_CHAIN_IDS.includes(chainId);
}

export function hasPermit2(chainId: number): boolean {
  return PERMIT2_CHAIN_IDS.includes(chainId);
}
