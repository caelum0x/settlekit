/**
 * Read USDC balances for fleet wallets via Circle programmable wallets.
 */

import { type Money, money } from "@settlekit/common";
import type { WalletsClient } from "@settlekit/circle-wallets";

export interface WalletBalances {
  getUsdcBalance(circleWalletId: string): Promise<Money>;
}

/** USDC balance reader backed by the Circle wallets API. */
export function createCircleBalances(wallets: WalletsClient): WalletBalances {
  return {
    async getUsdcBalance(circleWalletId: string): Promise<Money> {
      const balances = await wallets.getWalletBalance(circleWalletId);
      const usdc = balances.find((b) => b.token.symbol?.toUpperCase() === "USDC");
      return money(usdc?.amount ?? "0");
    },
  };
}
