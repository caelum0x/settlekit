import type { Result, SettleKitError } from "@settlekit/common";
import { generateId, notFound, ok } from "@settlekit/common";
import {
  openDispute,
  resolve,
  submitEvidence,
  type OpenDisputeInput,
  type SubmitEvidenceInput,
} from "./dispute.js";
import type { DisputeStore } from "./store.js";
import type { Dispute, DisputeResolution } from "./types.js";

/**
 * Orchestrates dispute lifecycle against a DisputeStore. Evidence ids and
 * dispute ids are minted via the injected generators; all transitions are
 * validated and persisted immutably.
 */
export class DisputeService {
  constructor(
    private readonly store: DisputeStore,
    private readonly generateDisputeId: () => string = () => generateId("payment"),
    private readonly generateEvidenceId: () => string = () => generateId("payment"),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async open(input: OpenDisputeInput): Promise<Result<Dispute, SettleKitError>> {
    const created = openDispute(input, this.generateDisputeId, this.now());
    if (!created.ok) return created;
    const saved = await this.store.save(created.value);
    return ok(saved);
  }

  async submitEvidence(disputeId: string, input: SubmitEvidenceInput): Promise<Result<Dispute, SettleKitError>> {
    const existing = await this.store.findById(disputeId);
    if (!existing) return { ok: false, error: notFound(`dispute ${disputeId} not found`) };
    const transitioned = submitEvidence(existing, input, this.generateEvidenceId, this.now());
    if (!transitioned.ok) return transitioned;
    const saved = await this.store.save(transitioned.value);
    return ok(saved);
  }

  async resolve(disputeId: string, outcome: DisputeResolution): Promise<Result<Dispute, SettleKitError>> {
    const existing = await this.store.findById(disputeId);
    if (!existing) return { ok: false, error: notFound(`dispute ${disputeId} not found`) };
    const transitioned = resolve(existing, outcome, this.now());
    if (!transitioned.ok) return transitioned;
    const saved = await this.store.save(transitioned.value);
    return ok(saved);
  }

  async get(disputeId: string): Promise<Dispute | undefined> {
    return this.store.findById(disputeId);
  }

  async listByPayment(paymentId: string): Promise<Dispute[]> {
    return this.store.listByPayment(paymentId);
  }

  async listByCustomer(customerId: string): Promise<Dispute[]> {
    return this.store.listByCustomer(customerId);
  }

  async listOpen(): Promise<Dispute[]> {
    return this.store.listOpen();
  }
}
