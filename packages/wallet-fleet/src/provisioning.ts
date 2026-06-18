/**
 * Provision new fleet wallets via Circle programmable wallets and register them.
 */

import { SettleKitError, type PaymentNetwork } from "@settlekit/common";
import type { CircleBlockchain, WalletsClient } from "@settlekit/circle-wallets";
import type { WalletRegistry } from "./registry.js";
import type { FleetWallet, WalletOwnerType } from "./types.js";

export interface ProvisionWalletInput {
  ownerType: WalletOwnerType;
  ownerId: string;
  label?: string;
}

export interface WalletProvisioner {
  provision(input: ProvisionWalletInput): Promise<FleetWallet>;
}

export interface CircleProvisionerConfig {
  wallets: WalletsClient;
  walletSetId: string;
  blockchain: CircleBlockchain;
  /** The settlement network these wallets transact on. */
  network: PaymentNetwork;
  registry: WalletRegistry;
}

/** Create wallets on a Circle wallet set and register them in the fleet. */
export function createCircleProvisioner(config: CircleProvisionerConfig): WalletProvisioner {
  return {
    async provision(input: ProvisionWalletInput): Promise<FleetWallet> {
      const created = await config.wallets.createWallets({
        walletSetId: config.walletSetId,
        blockchains: [config.blockchain],
        count: 1,
      });
      const wallet = created[0];
      if (wallet === undefined) {
        throw new SettleKitError({
          code: "integration_error",
          message: "Circle did not return a provisioned wallet",
        });
      }
      return config.registry.register({
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        address: wallet.address,
        network: config.network,
        circleWalletId: wallet.id,
        ...(input.label !== undefined ? { label: input.label } : {}),
      });
    },
  };
}
