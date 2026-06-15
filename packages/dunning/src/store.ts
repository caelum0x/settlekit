import type { DunningState } from "./types.js";

/**
 * Persistence boundary for dunning campaigns, keyed by subscriptionId
 * (one active campaign per subscription at a time).
 */
export interface DunningStore {
  save(state: DunningState): Promise<DunningState>;
  findBySubscription(subscriptionId: string): Promise<DunningState | undefined>;
  listActive(): Promise<DunningState[]>;
  /** Active campaigns with an attempt due at or before `now`. */
  listDue(now: Date): Promise<DunningState[]>;
  listAll(): Promise<DunningState[]>;
}

/** In-memory DunningStore for tests, local dev, and as a reference impl. */
export class InMemoryDunningStore implements DunningStore {
  private readonly states = new Map<string, DunningState>();

  async save(state: DunningState): Promise<DunningState> {
    const stored = clone(state);
    this.states.set(stored.subscriptionId, stored);
    return clone(stored);
  }

  async findBySubscription(subscriptionId: string): Promise<DunningState | undefined> {
    const found = this.states.get(subscriptionId);
    return found ? clone(found) : undefined;
  }

  async listActive(): Promise<DunningState[]> {
    return this.snapshot().filter((s) => s.status === "active");
  }

  async listDue(now: Date): Promise<DunningState[]> {
    const cutoff = now.getTime();
    return this.snapshot().filter(
      (s) => s.status === "active" && s.nextAttemptAt !== undefined && new Date(s.nextAttemptAt).getTime() <= cutoff,
    );
  }

  async listAll(): Promise<DunningState[]> {
    return this.snapshot();
  }

  private snapshot(): DunningState[] {
    return Array.from(this.states.values(), clone);
  }
}

function clone(state: DunningState): DunningState {
  return { ...state, history: state.history.map((h) => ({ ...h })) };
}
