/**
 * ERC-8183 job lifecycle — fund, deliver, evaluate, settle an agent job in one
 * runnable command.
 *
 *   pnpm --filter @settlekit/examples erc8183-job
 *
 * Walks the full ERC-8183 happy path for a unit of autonomous-agent work on Arc:
 *
 *   createJob → fundEscrow → submitDeliverable → evaluate(pass) → settle
 *     → getJob (status === "settled")
 *
 * Everything here runs offline over {@link LocalErc8183Port} — deterministic, no
 * network, no credentials — so it executes in CI. Every client call returns a
 * `Result<T>` and is unwrapped with `unwrap`; the run-guard's `.catch` prints
 * any failure.
 *
 * NOTE on terminal state: the prompt's "Completed" maps to {@link JobStatus}
 * `"settled"` — there is no literal `"completed"` status. Reaching it REQUIRES an
 * explicit `settle()` after `evaluate(pass)`; `evaluate` alone only reaches
 * `"evaluated"`, and `settle` is rejected unless the evaluation passed.
 *
 * ── Going live (one-line swap, no flow changes) ──────────────────────────────
 * The chain dependency is consumer-owned, so the live wiring is shown here in
 * comments only. Swap the port; the steps below are identical.
 *
 *   viem-backed port (the concrete live swap):
 *
 *     import { createViemErc8183Port } from "@settlekit/erc8183-viem";
 *     import { configureErc8183 } from "@settlekit/erc8183";
 *
 *     const jobs = configureErc8183({ port: createViemErc8183Port(viemConfig) });
 *
 *   Circle DCW-backed port:
 *     A Circle Developer-Controlled Wallets deployment signs the escrow/settle
 *     calls through a DCW signer. The `@settlekit/erc8183-dcw` port factory
 *     (`createDcwErc8183Port`) is the planned home for this; until it lands, a
 *     consumer-owned `Erc8183Port` implementation works identically — build it to
 *     the `Erc8183Port` interface and pass it to `configureErc8183({ port })`.
 *
 * The only edit versus this demo is the `port:` argument; the order of calls,
 * validation, and receipts are unchanged.
 */

import { unwrap } from "@settlekit/common";
import {
  type Job,
  type JobStatus,
  LocalErc8183Port,
  configureErc8183,
} from "@settlekit/erc8183";

/** Address of the party requesting and funding the work. */
const REQUESTER = "0xRequesterWallet";

/** Address of the agent performing the work. */
const WORKER = "0xWorkerAgentWallet";

/** Escrowed USDC amount, as a decimal string. */
const AMOUNT_USDC = "100.00";

/** URI of the job specification. */
const SPEC_URI = "ipfs://settlekit-demo-job-spec.json";

/** URI of the submitted deliverable. */
const DELIVERABLE_URI = "ipfs://settlekit-demo-deliverable.json";

/** Numeric score recorded with the (passing) evaluation. */
const EVALUATION_SCORE = "98";

/** The structured outcome of the ERC-8183 job lifecycle demo. */
export interface Erc8183JobResult {
  /** On-chain job identifier (sequential, e.g. "job_1"). */
  readonly jobId: string;
  /**
   * Escrowed USDC amount as stored on the job, normalized via `money()`. Note
   * trailing zeros are stripped, so the input "100.00" reads back as "100".
   */
  readonly amountUsdc: string;
  /** On-chain transaction hash for job creation. */
  readonly createTxHash: string;
  /** Ordered trail of statuses the job moved through. */
  readonly statusTrail: readonly JobStatus[];
  /** Final job status read back (terminal happy path == "settled"). */
  readonly finalStatus: JobStatus;
  /** True when the job reached the terminal `"settled"` state. */
  readonly completed: boolean;
  /** Whether the recorded evaluation passed. */
  readonly evaluationPassed: boolean;
}

/**
 * Run the ERC-8183 job lifecycle end-to-end against {@link LocalErc8183Port}.
 *
 * Creates a job, funds escrow, submits a deliverable, evaluates it as a pass,
 * settles the escrow, then reads the final job back. Each step is unwrapped from
 * `Result<T>`; the returned {@link Erc8183JobResult} is test-assertable.
 */
export async function main(): Promise<Erc8183JobResult> {
  // Offline, deterministic ERC-8183 job client. Swap `new LocalErc8183Port`
  // for a viem/DCW port (see file header) to drive the real Arc job contract.
  const port = new LocalErc8183Port();
  const jobs = configureErc8183({ port });

  const statusTrail: JobStatus[] = [];

  // 1) Create the job and post its spec (status: created).
  const created = unwrap(
    await jobs.createJob({
      requester: REQUESTER,
      worker: WORKER,
      amountUsdc: AMOUNT_USDC,
      specUri: SPEC_URI,
    }),
  );
  statusTrail.push("created");

  // 2) Fund the USDC escrow (created -> funded).
  unwrap(await jobs.fundEscrow({ jobId: created.jobId, amountUsdc: AMOUNT_USDC }));
  statusTrail.push("funded");

  // 3) Submit the deliverable (funded -> submitted).
  unwrap(
    await jobs.submitDeliverable({ jobId: created.jobId, deliverableUri: DELIVERABLE_URI }),
  );
  statusTrail.push("submitted");

  // 4) Evaluate as a pass (submitted -> evaluated; records evaluation.passed).
  unwrap(await jobs.evaluate({ jobId: created.jobId, passed: true, scoreOrUri: EVALUATION_SCORE }));
  statusTrail.push("evaluated");

  // 5) Settle the escrow to the worker (evaluated -> settled). REQUIRED to reach
  //    the terminal/"Completed" state; settle is rejected unless evaluation passed.
  unwrap(await jobs.settle({ jobId: created.jobId }));
  statusTrail.push("settled");

  // 6) Read the final job back and assert it settled.
  const job: Job = unwrap(await jobs.getJob({ jobId: created.jobId }));

  return {
    jobId: created.jobId,
    amountUsdc: job.amount.amount,
    createTxHash: created.txHash,
    statusTrail,
    finalStatus: job.status,
    completed: job.status === "settled",
    evaluationPassed: job.evaluation?.passed === true,
  };
}

/** Print a line to stdout (only used inside the run-guard, never on import). */
function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((result) => {
      out("");
      out("  ╔══════════════════════════════════════════════════════════════╗");
      out("  ║   ERC-8183 job lifecycle — escrow · deliver · evaluate · pay  ║");
      out("  ║   SettleKit · offline LocalErc8183Port · flips live in one    ║");
      out("  ╚══════════════════════════════════════════════════════════════╝");
      out("");
      out(`  job ${result.jobId}  escrow ${result.amountUsdc} USDC`);
      out(`     createTx     ${result.createTxHash}`);
      out("");
      out("  ── Job state trail ─────────────────────────────────────────────");
      out("");
      out(`     ${result.statusTrail.join("  →  ")}`);
      out("");
      out(`     evaluation passed  ${result.evaluationPassed}`);
      out(`     final status       ${result.finalStatus}  (Completed == settled)`);
      out("");
      out(`  job completed: ${result.completed ? "yes" : "NO"}`);
      out("");
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `erc8183-job demo failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
