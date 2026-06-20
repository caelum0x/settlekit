/**
 * {@link LocalErc8183Port} — a deterministic, in-memory {@link Erc8183Port} for
 * tests, demos, and local development. It never touches a chain: it holds jobs
 * in a `Map`, enforces the job state machine ({@link assertTransition}), mints
 * sequential job ids (`job_1`, `job_2`, ...), and returns synthetic,
 * monotonically-numbered transaction hashes so assertions are stable across
 * runs. No `Math.random` / `Date.now` is used.
 *
 * Every state change creates a NEW {@link Job} object (immutability); stored
 * jobs are never mutated in place.
 */

import { conflict, money, notFound } from "@settlekit/common";
import type { Erc8183Port } from "./port.js";
import { type Job, type JobEvaluation, type TxResult, assertTransition } from "./types.js";

/** Operations that may be forced to throw, to exercise client error mapping. */
export type LocalErc8183Op =
  | "createJob"
  | "fundEscrow"
  | "submitDeliverable"
  | "evaluate"
  | "settle"
  | "refund"
  | "getJob";

/** Options controlling the local port's simulated behavior. */
export interface LocalErc8183Options {
  /** Operations named here throw a generic Error, to exercise error mapping. */
  throwOn?: readonly LocalErc8183Op[];
}

const SUCCESS: TxResult["status"] = "success";

export class LocalErc8183Port implements Erc8183Port {
  private readonly jobsById = new Map<string, Job>();
  private readonly throwOn: ReadonlySet<LocalErc8183Op>;
  private jobCounter = 0;
  private txCounter = 0;

  constructor(options: LocalErc8183Options = {}) {
    this.throwOn = new Set(options.throwOn ?? []);
  }

  /** A snapshot array of every stored job, for test assertions. */
  jobs(): readonly Job[] {
    return [...this.jobsById.values()];
  }

  /** Mint the next synthetic transaction hash. */
  private nextTx(): string {
    this.txCounter += 1;
    return `0xlocal${this.txCounter.toString(16).padStart(8, "0")}`;
  }

  /** Throw the simulated failure for `op` when configured. */
  private guard(op: LocalErc8183Op): void {
    if (this.throwOn.has(op)) {
      throw new Error(`simulated ${op} failure`);
    }
  }

  /** Load a job or throw `not_found`. */
  private require(jobId: string): Job {
    const job = this.jobsById.get(jobId);
    if (job === undefined) {
      throw notFound(`job "${jobId}" was not found`, { jobId });
    }
    return job;
  }

  async createJob(p: {
    requester: string;
    worker: string;
    amountUsdc: string;
    specUri: string;
  }): Promise<{ jobId: string; txHash: string }> {
    this.guard("createJob");
    this.jobCounter += 1;
    const jobId = `job_${this.jobCounter}`;
    const job: Job = {
      id: jobId,
      requester: p.requester,
      worker: p.worker,
      amount: money(p.amountUsdc),
      status: "created",
    };
    this.jobsById.set(jobId, job);
    return { jobId, txHash: this.nextTx() };
  }

  async fundEscrow(p: { jobId: string; amountUsdc: string }): Promise<TxResult> {
    this.guard("fundEscrow");
    const job = this.require(p.jobId);
    const status = assertTransition(job.status, "fund");
    this.jobsById.set(job.id, { ...job, status });
    return { txHash: this.nextTx(), status: SUCCESS };
  }

  async submitDeliverable(p: { jobId: string; deliverableUri: string }): Promise<TxResult> {
    this.guard("submitDeliverable");
    const job = this.require(p.jobId);
    const status = assertTransition(job.status, "submit");
    this.jobsById.set(job.id, { ...job, status, deliverableUri: p.deliverableUri });
    return { txHash: this.nextTx(), status: SUCCESS };
  }

  async evaluate(p: { jobId: string; passed: boolean; scoreOrUri?: string }): Promise<TxResult> {
    this.guard("evaluate");
    const job = this.require(p.jobId);
    const status = assertTransition(job.status, p.passed ? "evaluate_pass" : "evaluate_fail");
    const evaluation: JobEvaluation = {
      passed: p.passed,
      ...(p.scoreOrUri !== undefined ? { scoreOrUri: p.scoreOrUri } : {}),
    };
    this.jobsById.set(job.id, { ...job, status, evaluation });
    return { txHash: this.nextTx(), status: SUCCESS };
  }

  async settle(p: { jobId: string }): Promise<TxResult> {
    this.guard("settle");
    const job = this.require(p.jobId);
    const status = assertTransition(job.status, "settle");
    // The transition table allows settle from `evaluated` regardless of verdict;
    // the lifecycle additionally forbids settling a failed evaluation.
    if (job.evaluation?.passed !== true) {
      throw conflict("cannot settle a failed evaluation", { jobId: p.jobId });
    }
    this.jobsById.set(job.id, { ...job, status });
    return { txHash: this.nextTx(), status: SUCCESS };
  }

  async refund(p: { jobId: string }): Promise<TxResult> {
    this.guard("refund");
    const job = this.require(p.jobId);
    const status = assertTransition(job.status, "refund");
    this.jobsById.set(job.id, { ...job, status });
    return { txHash: this.nextTx(), status: SUCCESS };
  }

  async getJob(p: { jobId: string }): Promise<Job> {
    this.guard("getJob");
    return this.require(p.jobId);
  }
}
