/**
 * {@link JobClient} — the SettleKit-idiomatic facade over an injected
 * {@link Erc8183Port}. Every method validates its request, calls the port, and
 * returns a `Result` instead of throwing, so callers handle success/failure
 * uniformly. Thrown port errors are mapped to a retryable `integration_error`;
 * when the thrown cause is already a {@link SettleKitError} (e.g. a `conflict`
 * from an illegal on-chain transition or a `not_found`), its code is preserved
 * rather than masked.
 */

import { type Result, SettleKitError, conflict, err, money, ok } from "@settlekit/common";
import type { Erc8183Port } from "./port.js";
import type {
  CreateJobRequest,
  CreateJobResult,
  EvaluateRequest,
  FundEscrowRequest,
  Job,
  JobIdRequest,
  SubmitDeliverableRequest,
  TxResult,
} from "./types.js";
import { firstError, validateAddress, validateAmount, validateNonEmpty } from "./validate.js";

/** Configuration for a {@link JobClient}. */
export interface JobClientConfig {
  /** The injected ERC-8183 port (viem + DCW implementation, or a local mock). */
  port: Erc8183Port;
}

export class JobClient {
  private readonly port: Erc8183Port;

  constructor(config: JobClientConfig) {
    this.port = config.port;
  }

  /**
   * Wrap a port call, mapping thrown errors to a typed error. A thrown
   * {@link SettleKitError} (conflict/not_found/...) passes through with its code
   * intact; any other throw becomes a retryable `integration_error`.
   */
  private async run<T>(label: string, call: () => Promise<T>): Promise<Result<T>> {
    try {
      return ok(await call());
    } catch (cause) {
      if (SettleKitError.is(cause)) {
        return err(cause);
      }
      return err(
        new SettleKitError({
          code: "integration_error",
          message: `erc8183 ${label} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          retryable: true,
          cause,
          details: { op: label },
        }),
      );
    }
  }

  /** Create a job and post its spec, escrowing `amountUsdc` of USDC. */
  async createJob(req: CreateJobRequest): Promise<Result<CreateJobResult>> {
    const invalid = firstError(
      validateAddress(req.requester, "requester"),
      validateAddress(req.worker, "worker"),
      validateNonEmpty(req.specUri, "specUri"),
      validateAmount(req.amountUsdc),
    );
    if (invalid !== null) return err(invalid);

    // Assert the amount is a canonical USDC value before touching the chain.
    const amount = money(req.amountUsdc);

    return this.run("createJob", () =>
      this.port.createJob({
        requester: req.requester,
        worker: req.worker,
        amountUsdc: amount.amount,
        specUri: req.specUri,
      }),
    );
  }

  /** Fund the USDC escrow for an existing job. */
  async fundEscrow(req: FundEscrowRequest): Promise<Result<TxResult>> {
    const invalid = firstError(
      validateNonEmpty(req.jobId, "jobId"),
      validateAmount(req.amountUsdc),
    );
    if (invalid !== null) return err(invalid);

    const amount = money(req.amountUsdc);

    return this.run("fundEscrow", () =>
      this.port.fundEscrow({ jobId: req.jobId, amountUsdc: amount.amount }),
    );
  }

  /** Submit a deliverable for a funded job. */
  async submitDeliverable(req: SubmitDeliverableRequest): Promise<Result<TxResult>> {
    const invalid = firstError(
      validateNonEmpty(req.jobId, "jobId"),
      validateNonEmpty(req.deliverableUri, "deliverableUri"),
    );
    if (invalid !== null) return err(invalid);

    return this.run("submitDeliverable", () =>
      this.port.submitDeliverable({
        jobId: req.jobId,
        deliverableUri: req.deliverableUri,
      }),
    );
  }

  /** Record an evaluation verdict for a submitted job. */
  async evaluate(req: EvaluateRequest): Promise<Result<TxResult>> {
    const invalid = firstError(
      validateNonEmpty(req.jobId, "jobId"),
      req.scoreOrUri !== undefined ? validateNonEmpty(req.scoreOrUri, "scoreOrUri") : null,
    );
    if (invalid !== null) return err(invalid);

    return this.run("evaluate", () =>
      this.port.evaluate({
        jobId: req.jobId,
        passed: req.passed,
        ...(req.scoreOrUri !== undefined ? { scoreOrUri: req.scoreOrUri } : {}),
      }),
    );
  }

  /**
   * Settle the escrow to the worker. Performs an optional fast-fail pre-check via
   * {@link Erc8183Port.getJob} — rejecting with `conflict` when the job is not in
   * `evaluated` status or did not pass — but the on-chain guard (port) remains
   * authoritative.
   */
  async settle(req: JobIdRequest): Promise<Result<TxResult>> {
    const invalid = validateNonEmpty(req.jobId, "jobId");
    if (invalid !== null) return err(invalid);

    const precheck = await this.run("getJob", () => this.port.getJob({ jobId: req.jobId }));
    if (!precheck.ok) return precheck;
    const job = precheck.value;
    if (job.status !== "evaluated") {
      return err(
        conflict(`cannot settle a job in status "${job.status}"`, {
          jobId: req.jobId,
          status: job.status,
        }),
      );
    }
    if (job.evaluation?.passed !== true) {
      return err(
        conflict("cannot settle a failed evaluation", {
          jobId: req.jobId,
        }),
      );
    }

    return this.run("settle", () => this.port.settle({ jobId: req.jobId }));
  }

  /** Refund the escrow to the requester. */
  async refund(req: JobIdRequest): Promise<Result<TxResult>> {
    const invalid = validateNonEmpty(req.jobId, "jobId");
    if (invalid !== null) return err(invalid);

    return this.run("refund", () => this.port.refund({ jobId: req.jobId }));
  }

  /** Read the current state of a job. */
  async getJob(req: JobIdRequest): Promise<Result<Job>> {
    const invalid = validateNonEmpty(req.jobId, "jobId");
    if (invalid !== null) return err(invalid);

    return this.run("getJob", () => this.port.getJob({ jobId: req.jobId }));
  }
}
