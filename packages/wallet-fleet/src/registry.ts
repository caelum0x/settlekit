/**
 * The wallet registry: maps owners (agents, creators, authors) to wallets, with
 * lookups by id/address/owner and a kill-switch. In-memory here; a Pg-backed
 * store follows the repo's dual-store pattern.
 */

import { type IsoTimestamp, toIso, uuid } from "@settlekit/common";
import type { FleetWallet, RegisterWalletInput, WalletOwnerType } from "./types.js";

export interface WalletRegistry {
  register(input: RegisterWalletInput): Promise<FleetWallet>;
  getById(id: string): Promise<FleetWallet | undefined>;
  getByAddress(address: string): Promise<FleetWallet | undefined>;
  listByOwner(ownerType: WalletOwnerType, ownerId: string): Promise<FleetWallet[]>;
  list(): Promise<FleetWallet[]>;
  setKilled(id: string, killed: boolean): Promise<FleetWallet | undefined>;
}

function walletId(): string {
  return `flw_${uuid().replace(/-/g, "").slice(0, 24)}`;
}

export class InMemoryWalletRegistry implements WalletRegistry {
  private readonly wallets = new Map<string, FleetWallet>();
  private readonly now: () => IsoTimestamp;

  constructor(now: () => Date = () => new Date()) {
    this.now = () => toIso(now());
  }

  async register(input: RegisterWalletInput): Promise<FleetWallet> {
    const wallet: FleetWallet = {
      id: walletId(),
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      address: input.address,
      network: input.network ?? "arc",
      ...(input.circleWalletId !== undefined ? { circleWalletId: input.circleWalletId } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      killed: false,
      createdAt: this.now(),
    };
    this.wallets.set(wallet.id, wallet);
    return wallet;
  }

  async getById(id: string): Promise<FleetWallet | undefined> {
    return this.wallets.get(id);
  }

  async getByAddress(address: string): Promise<FleetWallet | undefined> {
    const lower = address.toLowerCase();
    return [...this.wallets.values()].find((w) => w.address.toLowerCase() === lower);
  }

  async listByOwner(ownerType: WalletOwnerType, ownerId: string): Promise<FleetWallet[]> {
    return [...this.wallets.values()].filter(
      (w) => w.ownerType === ownerType && w.ownerId === ownerId,
    );
  }

  async list(): Promise<FleetWallet[]> {
    return [...this.wallets.values()];
  }

  async setKilled(id: string, killed: boolean): Promise<FleetWallet | undefined> {
    const existing = this.wallets.get(id);
    if (existing === undefined) {
      return undefined;
    }
    const updated: FleetWallet = { ...existing, killed };
    this.wallets.set(id, updated);
    return updated;
  }
}
