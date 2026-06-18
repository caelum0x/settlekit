/**
 * Postgres-backed {@link WalletRegistry}. The canonical {@link FleetWallet}
 * lives in `metadata.__doc`; owner/address/killed columns are projected for the
 * fleet-management queries.
 */

import { eq, type Database, leptonWallets } from "@settlekit/database";
import { toIso, uuid } from "@settlekit/common";
import type {
  FleetWallet,
  RegisterWalletInput,
  WalletOwnerType,
  WalletRegistry,
} from "@settlekit/wallet-fleet";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

export class PgWalletRegistry implements WalletRegistry {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async upsert(wallet: FleetWallet): Promise<FleetWallet> {
    const projection = {
      ownerType: wallet.ownerType,
      ownerId: wallet.ownerId,
      address: wallet.address,
      network: wallet.network,
      circleWalletId: wallet.circleWalletId ?? null,
      label: wallet.label ?? null,
      killed: wallet.killed,
      metadata: packDoc(wallet),
      createdAt: new Date(wallet.createdAt),
    };
    await this.db
      .insert(leptonWallets)
      .values({ id: wallet.id, ...projection })
      .onConflictDoUpdate({ target: leptonWallets.id, set: projection });
    return wallet;
  }

  async register(input: RegisterWalletInput): Promise<FleetWallet> {
    const wallet: FleetWallet = {
      id: `flw_${uuid().replace(/-/g, "").slice(0, 24)}`,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      address: input.address,
      network: input.network ?? "arc",
      ...(input.circleWalletId !== undefined ? { circleWalletId: input.circleWalletId } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      killed: false,
      createdAt: toIso(this.now()),
    };
    return this.upsert(wallet);
  }

  async getById(id: string): Promise<FleetWallet | undefined> {
    const rows = await this.db
      .select({ metadata: leptonWallets.metadata })
      .from(leptonWallets)
      .where(eq(leptonWallets.id, id))
      .limit(1);
    return unpackDoc<FleetWallet>(rows[0]) ?? undefined;
  }

  async getByAddress(address: string): Promise<FleetWallet | undefined> {
    const rows = await this.db
      .select({ metadata: leptonWallets.metadata })
      .from(leptonWallets)
      .where(eq(leptonWallets.address, address))
      .limit(1);
    return unpackDoc<FleetWallet>(rows[0]) ?? undefined;
  }

  async listByOwner(ownerType: WalletOwnerType, ownerId: string): Promise<FleetWallet[]> {
    const rows = await this.db
      .select({ metadata: leptonWallets.metadata })
      .from(leptonWallets)
      .where(eq(leptonWallets.ownerId, ownerId));
    return unpackDocs<FleetWallet>(rows).filter((w) => w.ownerType === ownerType);
  }

  async list(): Promise<FleetWallet[]> {
    const rows = await this.db.select({ metadata: leptonWallets.metadata }).from(leptonWallets);
    return unpackDocs<FleetWallet>(rows);
  }

  async setKilled(id: string, killed: boolean): Promise<FleetWallet | undefined> {
    const existing = await this.getById(id);
    if (existing === undefined) {
      return undefined;
    }
    return this.upsert({ ...existing, killed });
  }
}
