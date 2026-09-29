/**
 * Persistence boundary for onchain billing plus the in-memory reference store.
 *
 * The one concurrency-critical operation is {@link OnchainBillingStore.claimCharge}:
 * it must atomically create-or-take the (subscription, period) charge so two
 * workers (or two ticks) can never pull the same period twice. The decision
 * logic lives in {@link decideClaim} so every store applies identical rules;
 * the in-memory store is atomic because it never awaits between read and
 * write, and the Postgres store does the same inside a row lock.
 */
import type { EscrowPaymentRecord } from "./escrow-records.js";
import type { ClaimInput, ClaimResult, OnchainCharge, OnchainSubscription } from "./types.js";

export interface SubscriptionFilter {
  organizationId?: string;
  customerId?: string;
  status?: OnchainSubscription["status"];
}

export interface OnchainBillingStore {
  saveSubscription(subscription: OnchainSubscription): Promise<OnchainSubscription>;
  getSubscription(id: string): Promise<OnchainSubscription | undefined>;
  listSubscriptions(filter?: SubscriptionFilter): Promise<OnchainSubscription[]>;
  /** Subscriptions the charge engine should look at (active / past_due with a grant). */
  listBillable(): Promise<OnchainSubscription[]>;

  /** Atomically create or take ownership of the (subscription, period) charge. */
  claimCharge(input: ClaimInput): Promise<ClaimResult>;
  saveCharge(charge: OnchainCharge): Promise<OnchainCharge>;
  getCharge(onchainSubscriptionId: string, periodIndex: number): Promise<OnchainCharge | undefined>;
  getChargeById(id: string): Promise<OnchainCharge | undefined>;
  listCharges(onchainSubscriptionId: string): Promise<OnchainCharge[]>;

  saveEscrowPayment(record: EscrowPaymentRecord): Promise<EscrowPaymentRecord>;
  getEscrowPayment(id: string): Promise<EscrowPaymentRecord | undefined>;
  listEscrowPayments(organizationId?: string): Promise<EscrowPaymentRecord[]>;
}

/**
 * Pure claim decision for an existing (or absent) charge row:
 *  - none                         -> new pending charge, attempt 1, leased
 *  - succeeded                    -> already_succeeded (never pull again)
 *  - awaiting_payment             -> awaiting_payment (invoice is out)
 *  - pending, lease still valid   -> in_flight (another worker owns it)
 *  - pending, lease expired       -> re-claimed with the SAME attempt and its
 *                                    recorded steps, so the provider reconciles
 *                                    the broadcast txs instead of re-sending
 *  - failed                       -> re-claimed as the next attempt
 */
export function decideClaim(existing: OnchainCharge | undefined, input: ClaimInput): ClaimResult {
  const nowIso = input.now.toISOString();
  const leaseUntil = new Date(input.now.getTime() + input.leaseMs).toISOString();
  if (existing === undefined) {
    const sub = input.subscription;
    return {
      kind: "claimed",
      charge: {
        id: input.newId(),
        onchainSubscriptionId: sub.id,
        periodIndex: input.periodIndex,
        network: sub.network,
        method: sub.method,
        amount: sub.amountPerPeriod,
        status: "pending",
        attempt: 1,
        leaseUntil,
        steps: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    };
  }
  if (existing.status === "succeeded") return { kind: "already_succeeded", charge: existing };
  if (existing.status === "awaiting_payment") return { kind: "awaiting_payment", charge: existing };
  if (existing.status === "pending") {
    if (new Date(existing.leaseUntil).getTime() > input.now.getTime()) return { kind: "in_flight", charge: existing };
    return { kind: "claimed", charge: { ...existing, leaseUntil, updatedAt: nowIso } };
  }
  const { failureReason: _previous, ...rest } = existing;
  return {
    kind: "claimed",
    charge: { ...rest, status: "pending", attempt: existing.attempt + 1, leaseUntil, steps: [], updatedAt: nowIso },
  };
}

function copyCharge(charge: OnchainCharge): OnchainCharge {
  return { ...charge, steps: charge.steps.map((step) => ({ ...step })) };
}

function copySubscription(sub: OnchainSubscription): OnchainSubscription {
  return structuredClone(sub);
}

function chargeKey(subscriptionId: string, periodIndex: number): string {
  return `${subscriptionId}#${periodIndex}`;
}

export class InMemoryOnchainBillingStore implements OnchainBillingStore {
  private readonly subscriptions = new Map<string, OnchainSubscription>();
  private readonly charges = new Map<string, OnchainCharge>();
  private readonly escrow = new Map<string, EscrowPaymentRecord>();

  async saveSubscription(subscription: OnchainSubscription): Promise<OnchainSubscription> {
    this.subscriptions.set(subscription.id, copySubscription(subscription));
    return copySubscription(subscription);
  }

  async getSubscription(id: string): Promise<OnchainSubscription | undefined> {
    const found = this.subscriptions.get(id);
    return found ? copySubscription(found) : undefined;
  }

  async listSubscriptions(filter: SubscriptionFilter = {}): Promise<OnchainSubscription[]> {
    return [...this.subscriptions.values()]
      .filter((s) => filter.organizationId === undefined || s.organizationId === filter.organizationId)
      .filter((s) => filter.customerId === undefined || s.customerId === filter.customerId)
      .filter((s) => filter.status === undefined || s.status === filter.status)
      .map(copySubscription);
  }

  async listBillable(): Promise<OnchainSubscription[]> {
    return [...this.subscriptions.values()]
      .filter((s) => (s.status === "active" || s.status === "past_due") && s.grant !== undefined)
      .map(copySubscription);
  }

  async claimCharge(input: ClaimInput): Promise<ClaimResult> {
    // No await between read and write: atomic on the single JS thread.
    const key = chargeKey(input.subscription.id, input.periodIndex);
    const result = decideClaim(this.charges.get(key), input);
    if (result.kind === "claimed") this.charges.set(key, copyCharge(result.charge));
    return { ...result, charge: copyCharge(result.charge) } as ClaimResult;
  }

  async saveCharge(charge: OnchainCharge): Promise<OnchainCharge> {
    this.charges.set(chargeKey(charge.onchainSubscriptionId, charge.periodIndex), copyCharge(charge));
    return copyCharge(charge);
  }

  async getCharge(onchainSubscriptionId: string, periodIndex: number): Promise<OnchainCharge | undefined> {
    const found = this.charges.get(chargeKey(onchainSubscriptionId, periodIndex));
    return found ? copyCharge(found) : undefined;
  }

  async getChargeById(id: string): Promise<OnchainCharge | undefined> {
    const found = [...this.charges.values()].find((c) => c.id === id);
    return found ? copyCharge(found) : undefined;
  }

  async listCharges(onchainSubscriptionId: string): Promise<OnchainCharge[]> {
    return [...this.charges.values()]
      .filter((c) => c.onchainSubscriptionId === onchainSubscriptionId)
      .sort((a, b) => a.periodIndex - b.periodIndex)
      .map(copyCharge);
  }

  async saveEscrowPayment(record: EscrowPaymentRecord): Promise<EscrowPaymentRecord> {
    this.escrow.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async getEscrowPayment(id: string): Promise<EscrowPaymentRecord | undefined> {
    const found = this.escrow.get(id);
    return found ? structuredClone(found) : undefined;
  }

  async listEscrowPayments(organizationId?: string): Promise<EscrowPaymentRecord[]> {
    return [...this.escrow.values()]
      .filter((r) => organizationId === undefined || r.organizationId === organizationId)
      .map((r) => structuredClone(r));
  }
}
