/**
 * ERC-8004 agent lifecycle — agent identity, reputation, and validation in one
 * runnable command.
 *
 *   pnpm --filter @settlekit/examples erc8004-agent
 *
 * Walks the full ERC-8004 flow for an autonomous agent on Arc:
 *
 *   register identity → resolve agentId → giveFeedback → requestValidation
 *     → respondValidation → getValidationStatus
 *
 * Everything here runs offline over {@link LocalErc8004Port} — deterministic, no
 * network, no credentials — so it executes in CI. Every client call returns a
 * `Result<T>` and is unwrapped with `unwrap`; the run-guard's `.catch` prints
 * any failure.
 *
 * ── Going live (one-line swap, no flow changes) ──────────────────────────────
 * The chain dependency is consumer-owned, so the live wiring is shown here in
 * comments only. Swap the port; the six steps below are identical.
 *
 *   viem-backed port (the concrete live swap):
 *
 *     import { createViemErc8004Port } from "@settlekit/erc8004-viem";
 *     import { configureErc8004, ARC_TESTNET_REGISTRIES } from "@settlekit/erc8004";
 *
 *     const registry = configureErc8004({
 *       port: createViemErc8004Port({
 *         walletClient,
 *         publicClient,
 *         registries: ARC_TESTNET_REGISTRIES,
 *       }),
 *     });
 *
 *   Circle DCW-backed port:
 *
 *     import { createDcwErc8004Port } from "@settlekit/erc8004-dcw";
 *     import { configureErc8004, ARC_TESTNET_REGISTRIES } from "@settlekit/erc8004";
 *
 *     const registry = configureErc8004({
 *       port: createDcwErc8004Port({ ...dcwConfig, registries: ARC_TESTNET_REGISTRIES }),
 *     });
 *
 *   This signs registry calls through a Circle Developer-Controlled Wallets
 *   signer. As with viem, only the `port:` argument changes.
 *
 * The only edit versus this demo is the `port:` argument; the order of calls,
 * validation, and receipts are unchanged.
 *
 * Caveat: {@link LocalErc8004Port} derives `requestHash` via an FNV-1a hash for
 * stable in-memory lookup; it is NOT chain-compatible. A live viem port derives
 * the real bytes32 request handle via the ValidationRegistry's keccak scheme, so
 * assert the *shape* (/^0x[0-9a-f]{64}$/) rather than a specific value.
 */

import { unwrap } from "@settlekit/common";
import {
  type TxResult,
  type ValidationStatus,
  LocalErc8004Port,
  configureErc8004,
} from "@settlekit/erc8004";

/** The wallet that owns the agent identity registered in this demo. */
const AGENT_OWNER = "0xAgentOwnerWallet";

/** The validator wallet that responds to the validation request. */
const VALIDATOR = "0xValidatorWallet";

/** Metadata document describing the agent (e.g. an IPFS pointer). */
const METADATA_URI = "ipfs://settlekit-demo-agent.json";

/** URI describing what the validator is asked to attest. */
const REQUEST_URI = "ipfs://settlekit-demo-validation-request.json";

/**
 * Stable subject the local port hashes into a `requestHash`. Keeping it constant
 * means the same `requestHash` is reproduced, so status can be read back.
 */
const VALIDATION_SUBJECT = "agent:settlekit-demo:trade-execution";

/** Reputation score recorded for the agent (int 0..100). */
const FEEDBACK_SCORE = 95;

/** Response value that marks the validation as passed (100 == pass). */
const PASS_RESPONSE = 100;

/** The structured outcome of the ERC-8004 agent lifecycle demo. */
export interface Erc8004AgentResult {
  /** The minted agent identity id (sequential decimal string from the port). */
  readonly agentId: string;
  /** Wallet that owns the identity (== {@link AGENT_OWNER}). */
  readonly owner: string;
  /** Metadata URI resolved for the agent. */
  readonly metadataUri: string;
  /** Receipt of the identity-registration transaction. */
  readonly registerTx: TxResult;
  /** Receipt of the reputation-feedback transaction. */
  readonly feedbackTx: TxResult;
  /** The on-chain request handle for the validation request. */
  readonly requestHash: string;
  /** Receipt of the validator's response transaction. */
  readonly respondTx: TxResult;
  /** Final validation status read back from the registry. */
  readonly finalStatus: ValidationStatus;
  /** True when the agent reached the validated terminal state. */
  readonly validated: boolean;
}

/**
 * Run the ERC-8004 agent lifecycle end-to-end against {@link LocalErc8004Port}.
 *
 * Registers an agent identity, resolves its id, records reputation feedback,
 * requests and answers a validation, then reads the final status. Each step is
 * unwrapped from `Result<T>` and projected into the returned, test-assertable
 * {@link Erc8004AgentResult}.
 */
export async function main(): Promise<Erc8004AgentResult> {
  // Offline, deterministic ERC-8004 registry client. Swap `new LocalErc8004Port`
  // for a viem/DCW port (see file header) to drive the real Arc registries.
  const port = new LocalErc8004Port({ owner: AGENT_OWNER });
  const registry = configureErc8004({ port });

  // 1) Register the agent identity (mints the ERC-721, owned by AGENT_OWNER).
  const registerTx = unwrap(await registry.registerAgent({ metadataUri: METADATA_URI }));

  // 2) Resolve the owner's agent id so later steps can reference it.
  const identity = unwrap(await registry.resolveAgent({ owner: AGENT_OWNER }));
  if (identity === null) {
    throw new Error(`no agent registered for owner ${AGENT_OWNER}`);
  }

  // 3) Record reputation feedback. `tag` is REQUIRED and validated non-empty;
  //    `score` must be an integer 0..100.
  const feedbackTx = unwrap(
    await registry.giveFeedback({
      agentId: identity.agentId,
      score: FEEDBACK_SCORE,
      feedbackType: 0,
      tag: "successful_trade",
    }),
  );

  // 4) Request a validation; the port derives a stable request handle.
  const request = unwrap(
    await registry.requestValidation({
      agentId: identity.agentId,
      validator: VALIDATOR,
      requestUri: REQUEST_URI,
      subject: VALIDATION_SUBJECT,
    }),
  );

  // 5) Respond to the validation. response === 100 sets passed=true.
  const respondTx = unwrap(
    await registry.respondValidation({
      requestHash: request.requestHash,
      response: PASS_RESPONSE,
      tag: "ok",
    }),
  );

  // 6) Read back the final validation status.
  const finalStatus = unwrap(
    await registry.getValidationStatus({ requestHash: request.requestHash }),
  );

  return {
    agentId: identity.agentId,
    owner: identity.owner,
    metadataUri: identity.metadataUri,
    registerTx,
    feedbackTx,
    requestHash: request.requestHash,
    respondTx,
    finalStatus,
    validated: finalStatus.passed,
  };
}

/** Print a line to stdout (only used inside the run-guard, never on import). */
function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

/** Print a labeled transaction receipt block. */
function printTx(label: string, tx: TxResult): void {
  out(`     ${label.padEnd(12)} txHash       ${tx.txHash}`);
  out(`     ${"".padEnd(12)} explorerUrl  ${tx.explorerUrl ?? ""}`);
  out("");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((result) => {
      out("");
      out("  ╔══════════════════════════════════════════════════════════════╗");
      out("  ║   ERC-8004 agent lifecycle — identity · reputation · proof    ║");
      out("  ║   SettleKit · offline LocalErc8004Port · flips live in one    ║");
      out("  ╚══════════════════════════════════════════════════════════════╝");
      out("");
      out(`  agent ${result.agentId} owned by ${result.owner}`);
      out(`     metadataUri  ${result.metadataUri}`);
      out("");
      out("  ── Step 1 · register identity ──────────────────────────────────");
      out("");
      printTx("register", result.registerTx);
      out("  ── Step 3 · giveFeedback (score 95, tag successful_trade) ───────");
      out("");
      printTx("feedback", result.feedbackTx);
      out("  ── Step 4–5 · request + respond validation ─────────────────────");
      out("");
      out(`     requestHash  ${result.requestHash}`);
      printTx("respond", result.respondTx);
      out("  ── Step 6 · getValidationStatus ────────────────────────────────");
      out("");
      out(`     validator    ${result.finalStatus.validator}`);
      out(`     agentId      ${result.finalStatus.agentId}`);
      out(`     response     ${result.finalStatus.response}`);
      out(`     tag          ${result.finalStatus.tag}`);
      out(`     passed       ${result.finalStatus.passed}`);
      out("");
      out(`  agent validated: ${result.validated ? "yes" : "NO"}`);
      out("");
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `erc8004-agent demo failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
