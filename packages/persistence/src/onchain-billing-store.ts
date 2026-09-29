/**
 * Postgres-backed {@link OnchainBillingStore} shared by the API (intents,
 * grants, refunds) and the worker (per-period charges).
 *
 * `claimCharge` runs in a transaction holding a row lock on the
 * (subscription, period) charge — `SELECT ... FOR UPDATE`, or an
 * `INSERT ... ON CONFLICT DO NOTHING` race on the UNIQUE(subscription, period)
 * constraint when the row does not exist yet — and applies the shared
 * {@link decideClaim} rules, so two workers can never both own a period.
 */
import {
  and,
  eq,
  onchainCharges,
  onchainEscrowPayments,
  onchainSubscriptions,
  type Database,
} from "@settlekit/database";
import {
  decideClaim,
  type ClaimInput,
  type ClaimResult,
  type EscrowPaymentRecord,
  type OnchainBillingStore,
  type OnchainCharge,
  type OnchainSubscription,
  type SubscriptionFilter,
} from "@settlekit/onchain-billing";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

function chargeRow(charge: OnchainCharge) {
  return {
    onchainSubscriptionId: charge.onchainSubscriptionId,
    periodIndex: charge.periodIndex,
    status: charge.status,
    leaseUntil: new Date(charge.leaseUntil),
    metadata: packDoc(charge),
    updatedAt: new Date(charge.updatedAt),
  };
}

export class PgOnchainBillingStore implements OnchainBillingStore {
  constructor(private readonly db: Database) {}

  async saveSubscription(subscription: OnchainSubscription): Promise<OnchainSubscription> {
    const projection = {
      organizationId: subscription.organizationId,
      customerId: subscription.customerId,
      status: subscription.status,
      network: subscription.network,
      method: subscription.method,
      metadata: packDoc(subscription),
      updatedAt: new Date(subscription.updatedAt),
    };
    await this.db
      .insert(onchainSubscriptions)
      .values({ id: subscription.id, ...projection })
      .onConflictDoUpdate({ target: onchainSubscriptions.id, set: projection });
    return subscription;
  }

  async getSubscription(id: string): Promise<OnchainSubscription | undefined> {
    const rows = await this.db
      .select({ metadata: onchainSubscriptions.metadata })
      .from(onchainSubscriptions)
      .where(eq(onchainSubscriptions.id, id))
      .limit(1);
    return unpackDoc<OnchainSubscription>(rows[0]) ?? undefined;
  }

  async listSubscriptions(filter: SubscriptionFilter = {}): Promise<OnchainSubscription[]> {
    const conditions = [
      filter.organizationId !== undefined ? eq(onchainSubscriptions.organizationId, filter.organizationId) : undefined,
      filter.customerId !== undefined ? eq(onchainSubscriptions.customerId, filter.customerId) : undefined,
      filter.status !== undefined ? eq(onchainSubscriptions.status, filter.status) : undefined,
    ].filter((c) => c !== undefined);
    const rows = await this.db
      .select({ metadata: onchainSubscriptions.metadata })
      .from(onchainSubscriptions)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return unpackDocs<OnchainSubscription>(rows);
  }

  async listBillable(): Promise<OnchainSubscription[]> {
    const [active, pastDue] = await Promise.all([
      this.listSubscriptions({ status: "active" }),
      this.listSubscriptions({ status: "past_due" }),
    ]);
    return [...active, ...pastDue].filter((s) => s.grant !== undefined);
  }

  async claimCharge(input: ClaimInput): Promise<ClaimResult> {
    return this.db.transaction(async (tx) => {
      const existing = await this.lockCharge(tx, input.subscription.id, input.periodIndex);
      if (existing === undefined) {
        const result = decideClaim(undefined, input);
        const inserted = await tx
          .insert(onchainCharges)
          .values({ id: result.charge.id, ...chargeRow(result.charge), createdAt: new Date(result.charge.createdAt) })
          .onConflictDoNothing({ target: [onchainCharges.onchainSubscriptionId, onchainCharges.periodIndex] })
          .returning({ id: onchainCharges.id });
        if (inserted.length > 0) return result;
        // Lost the insert race: decide against the winner's row.
        const winner = await this.lockCharge(tx, input.subscription.id, input.periodIndex);
        return this.decideAndUpdate(tx, winner, input);
      }
      return this.decideAndUpdate(tx, existing, input);
    });
  }

  private async decideAndUpdate(tx: Tx, existing: OnchainCharge | undefined, input: ClaimInput): Promise<ClaimResult> {
    const result = decideClaim(existing, input);
    if (result.kind === "claimed" && existing !== undefined) {
      await tx.update(onchainCharges).set(chargeRow(result.charge)).where(eq(onchainCharges.id, existing.id));
    }
    return result;
  }

  private async lockCharge(tx: Tx, subscriptionId: string, periodIndex: number): Promise<OnchainCharge | undefined> {
    const rows = await tx
      .select({ metadata: onchainCharges.metadata })
      .from(onchainCharges)
      .where(and(eq(onchainCharges.onchainSubscriptionId, subscriptionId), eq(onchainCharges.periodIndex, periodIndex)))
      .for("update")
      .limit(1);
    return unpackDoc<OnchainCharge>(rows[0]) ?? undefined;
  }

  async saveCharge(charge: OnchainCharge): Promise<OnchainCharge> {
    const row = chargeRow(charge);
    await this.db
      .insert(onchainCharges)
      .values({ id: charge.id, ...row, createdAt: new Date(charge.createdAt) })
      .onConflictDoUpdate({ target: [onchainCharges.onchainSubscriptionId, onchainCharges.periodIndex], set: row });
    return charge;
  }

  async getCharge(onchainSubscriptionId: string, periodIndex: number): Promise<OnchainCharge | undefined> {
    const rows = await this.db
      .select({ metadata: onchainCharges.metadata })
      .from(onchainCharges)
      .where(and(eq(onchainCharges.onchainSubscriptionId, onchainSubscriptionId), eq(onchainCharges.periodIndex, periodIndex)))
      .limit(1);
    return unpackDoc<OnchainCharge>(rows[0]) ?? undefined;
  }

  async getChargeById(id: string): Promise<OnchainCharge | undefined> {
    const rows = await this.db
      .select({ metadata: onchainCharges.metadata })
      .from(onchainCharges)
      .where(eq(onchainCharges.id, id))
      .limit(1);
    return unpackDoc<OnchainCharge>(rows[0]) ?? undefined;
  }

  async listCharges(onchainSubscriptionId: string): Promise<OnchainCharge[]> {
    const rows = await this.db
      .select({ metadata: onchainCharges.metadata })
      .from(onchainCharges)
      .where(eq(onchainCharges.onchainSubscriptionId, onchainSubscriptionId));
    return unpackDocs<OnchainCharge>(rows).sort((a, b) => a.periodIndex - b.periodIndex);
  }

  async saveEscrowPayment(record: EscrowPaymentRecord): Promise<EscrowPaymentRecord> {
    const projection = {
      organizationId: record.organizationId,
      status: record.status,
      metadata: packDoc(record),
      updatedAt: new Date(record.updatedAt),
    };
    await this.db
      .insert(onchainEscrowPayments)
      .values({ id: record.id, ...projection })
      .onConflictDoUpdate({ target: onchainEscrowPayments.id, set: projection });
    return record;
  }

  async getEscrowPayment(id: string): Promise<EscrowPaymentRecord | undefined> {
    const rows = await this.db
      .select({ metadata: onchainEscrowPayments.metadata })
      .from(onchainEscrowPayments)
      .where(eq(onchainEscrowPayments.id, id))
      .limit(1);
    return unpackDoc<EscrowPaymentRecord>(rows[0]) ?? undefined;
  }

  async listEscrowPayments(organizationId?: string): Promise<EscrowPaymentRecord[]> {
    const rows = await this.db
      .select({ metadata: onchainEscrowPayments.metadata })
      .from(onchainEscrowPayments)
      .where(organizationId !== undefined ? eq(onchainEscrowPayments.organizationId, organizationId) : undefined);
    return unpackDocs<EscrowPaymentRecord>(rows);
  }
}
