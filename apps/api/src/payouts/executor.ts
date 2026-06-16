/**
 * Payout execution port + a real Circle developer-controlled-wallets
 * implementation.
 *
 * The base routes record payouts and let an operator mark them paid with a
 * txHash they obtained out-of-band. {@link PayoutExecutor} closes that gap: it
 * actually moves USDC from a SettleKit-controlled treasury wallet to the
 * merchant's address via `@settlekit/circle-wallets`. When Circle wallet creds
 * are absent the executor is `null` and `/execute` returns a clear error.
 */
import { SettleKitError, type Money } from "@settlekit/common";
import type { WalletsClient } from "@settlekit/circle-wallets";

/** A payout to move on-chain. */
export interface PayoutExecutionRequest {
  /** Destination merchant wallet. */
  walletAddress: string;
  /** USDC amount to send. */
  amount: Money;
  /** Settlement network (arc | base | ethereum). */
  network: string;
  /** The payout id, echoed as the provider `refId` for reconciliation. */
  refId: string;
}

/** Outcome of initiating a payout transfer with the provider. */
export interface PayoutExecution {
  /** Provider transaction reference (the Circle transaction id). */
  providerRef: string;
  /** Provider lifecycle state (e.g. INITIATED, COMPLETE). */
  state: string;
  /** On-chain hash, present once the provider has broadcast the transfer. */
  txHash?: string;
}

/** Initiates real payout transfers. */
export interface PayoutExecutor {
  execute(request: PayoutExecutionRequest): Promise<PayoutExecution>;
  /**
   * Re-poll a previously-initiated transfer by its provider reference, so an
   * async settlement (Circle transfer → on-chain hash) can be reconciled.
   */
  reconcile(providerRef: string): Promise<PayoutExecution>;
}

/** Settings for the Circle-wallets-backed executor. */
export interface CircleWalletsExecutorConfig {
  /** The SettleKit treasury wallet that funds payouts. */
  sourceWalletId: string;
}

/**
 * Build a {@link PayoutExecutor} that sends USDC from a developer-controlled
 * Circle wallet. The USDC token id is resolved from the source wallet's
 * balances so the executor works on whatever chain the wallet lives on.
 */
export function createCircleWalletsPayoutExecutor(
  wallets: WalletsClient,
  config: CircleWalletsExecutorConfig,
): PayoutExecutor {
  return {
    async execute(request: PayoutExecutionRequest): Promise<PayoutExecution> {
      const balances = await wallets.getWalletBalance(config.sourceWalletId);
      const usdc = balances.find((b) => b.token.symbol === "USDC");
      if (!usdc) {
        throw new SettleKitError({
          code: "integration_error",
          message: `treasury wallet ${config.sourceWalletId} holds no USDC token balance`,
        });
      }

      const tx = await wallets.createTransfer({
        walletId: config.sourceWalletId,
        destinationAddress: request.walletAddress,
        tokenId: usdc.token.id,
        amount: request.amount.amount,
        refId: request.refId,
      });

      return {
        providerRef: tx.id,
        state: tx.state,
        ...(tx.txHash ? { txHash: tx.txHash } : {}),
      };
    },

    async reconcile(providerRef: string): Promise<PayoutExecution> {
      const tx = await wallets.getTransaction(providerRef);
      return {
        providerRef: tx.id,
        state: tx.state,
        ...(tx.txHash ? { txHash: tx.txHash } : {}),
      };
    },
  };
}
