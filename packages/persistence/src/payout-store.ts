/**
 * Postgres-backed {@link PayoutStore}. The canonical {@link Payout} lives in
 * `metadata.__doc`; org / wallet / amount / status columns are projected for the
 * by-organization query and admin tooling.
 */
import { eq, type Database, payouts } from "@settlekit/database";
import type { Payout, PayoutStore } from "@settlekit/payouts";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

/** Convert an optional ISO timestamp to a Date for a `timestamptz` column. */
function toDate(iso: string | undefined): Date | null {
  return iso ? new Date(iso) : null;
}

export class PgPayoutStore implements PayoutStore {
  constructor(private readonly db: Database) {}

  async save(payout: Payout): Promise<Payout> {
    const projection = {
      organizationId: payout.organizationId,
      walletAddress: payout.walletAddress,
      currency: payout.amount.currency,
      amount: payout.amount.amount,
      network: payout.network,
      status: payout.status,
      txHash: payout.txHash ?? null,
      failureReason: payout.failureReason ?? null,
      paidAt: toDate(payout.paidAt),
      metadata: packDoc(payout),
    };
    await this.db
      .insert(payouts)
      .values({ id: payout.id, ...projection })
      .onConflictDoUpdate({ target: payouts.id, set: projection });
    return payout;
  }

  async findById(id: string): Promise<Payout | undefined> {
    const rows = await this.db
      .select({ metadata: payouts.metadata })
      .from(payouts)
      .where(eq(payouts.id, id))
      .limit(1);
    return unpackDoc<Payout>(rows[0]) ?? undefined;
  }

  async listByOrganization(organizationId: string): Promise<Payout[]> {
    const rows = await this.db
      .select({ metadata: payouts.metadata })
      .from(payouts)
      .where(eq(payouts.organizationId, organizationId));
    return unpackDocs<Payout>(rows);
  }

  async listAll(): Promise<Payout[]> {
    const rows = await this.db.select({ metadata: payouts.metadata }).from(payouts);
    return unpackDocs<Payout>(rows);
  }
}
