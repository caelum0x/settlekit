/**
 * Developer-controlled wallet **contract execution** + transaction polling for
 * Circle Web3 Services (W3S) — the mechanism Arc's ERC-8004/8183 tutorials use
 * (`createContractExecutionTransaction` + `getTransaction` polling to a terminal
 * `COMPLETE` / `FAILED` state).
 *
 * Two pieces live here:
 *   - `buildContractExecutionRequest` — a pure request builder that mirrors
 *     `createTransfer`'s body shape exactly (idempotencyKey, domain fields,
 *     `feeLevel` defaulting to MEDIUM, refId, entitySecretCiphertext). The
 *     `createContractExecution` method on `WalletsClient` composes this with the
 *     same private `send` / `resolveEntitySecret` helpers used by every mutation.
 *   - `pollTransaction` — a standalone helper that polls a transaction via the
 *     public `getTransaction` until it reaches a terminal state. A `sleep` is
 *     injectable so tests run deterministically with no real timers.
 *
 * This package flattens the gas fee to a top-level `feeLevel` (its own REST
 * convention, matching `createTransfer`) rather than the Arc SDK's nested
 * `fee: { type: "level", config: { feeLevel } }`.
 *
 * Source: https://developers.circle.com/w3s (Developer-Controlled Wallets).
 */
import { SettleKitError } from "@settlekit/common";
import { requireString } from "./envelope.js";
import type { WalletsRequest } from "./http.js";
import type { WalletsClient } from "./client.js";
import type { EntitySecretInput } from "./client.js";
import type {
  CircleBlockchain,
  CircleFeeLevel,
  CircleTransactionResource,
  CircleTransactionState,
} from "./types.js";

/** Endpoint for developer-controlled contract execution transactions. */
const CONTRACT_EXECUTION_PATH = "/v1/w3s/developer/transactions/contractExecution";

/** Terminal failure states: a transaction in any of these will never complete. */
const TERMINAL_FAILURE_STATES: ReadonlySet<CircleTransactionState> = new Set([
  "FAILED",
  "CANCELLED",
  "DENIED",
]);

/** Default number of poll attempts before `pollTransaction` times out. */
export const DEFAULT_POLL_ATTEMPTS = 30;
/** Default delay (ms) between poll attempts. */
export const DEFAULT_POLL_DELAY_MS = 2000;

/**
 * Input for a developer-controlled contract execution transaction. Keys on
 * `walletAddress` + `blockchain` (the contractExecution endpoint accepts these
 * as an alternative to `walletId`). Mirrors `CreateTransferInput`'s entity
 * secret / idempotency / refId conventions.
 */
export interface CreateContractExecutionInput extends EntitySecretInput {
  /** Source developer-controlled wallet address. */
  walletAddress: string;
  /** Blockchain the wallet (and target contract) live on. */
  blockchain: CircleBlockchain;
  /** Target smart-contract address to call. */
  contractAddress: string;
  /** ABI function signature, e.g. "mint(address,uint256)". */
  abiFunctionSignature: string;
  /** Positional ABI arguments aligned with the function signature. */
  abiParameters: readonly (string | number | boolean)[];
  /** Gas fee level. Defaults to MEDIUM. */
  feeLevel?: CircleFeeLevel;
  /** Caller reference echoed back on the transaction. */
  refId?: string;
  idempotencyKey?: string;
}

/**
 * Build the contract-execution request. Pure: it never mutates `input`, and the
 * readonly `abiParameters` are spread into a fresh array so the body is plain
 * JSON-serializable. The body mirrors `createTransfer` exactly.
 */
export function buildContractExecutionRequest(
  input: CreateContractExecutionInput,
  entitySecretCiphertext: string,
): WalletsRequest {
  return {
    method: "POST",
    path: CONTRACT_EXECUTION_PATH,
    body: {
      idempotencyKey: input.idempotencyKey,
      walletAddress: input.walletAddress,
      blockchain: input.blockchain,
      contractAddress: input.contractAddress,
      abiFunctionSignature: input.abiFunctionSignature,
      abiParameters: [...input.abiParameters],
      feeLevel: input.feeLevel ?? "MEDIUM",
      refId: input.refId,
      entitySecretCiphertext,
    },
  };
}

/** Options for {@link pollTransaction}. */
export interface PollTransactionOptions {
  /** Transaction id to poll. */
  id: string;
  /** Maximum number of `getTransaction` calls. Defaults to {@link DEFAULT_POLL_ATTEMPTS}. */
  attempts?: number;
  /** Delay between attempts in ms. Defaults to {@link DEFAULT_POLL_DELAY_MS}. */
  delayMs?: number;
  /** Injectable sleep for deterministic tests; defaults to a real timer-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** Real timer-based sleep used as the production default. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Poll a transaction until it reaches a terminal state.
 *
 * - On `COMPLETE` resolves with the transaction (its `txHash` is populated once
 *   broadcast).
 * - On `FAILED` / `CANCELLED` / `DENIED` throws a `SettleKitError`
 *   (`integration_error`) carrying the failure state and Circle error fields.
 * - After exhausting `attempts` without a terminal state throws a retryable
 *   `SettleKitError` (`integration_error`) carrying the last-seen state.
 *
 * No `sleep` is awaited after the final attempt (off-by-one safe).
 */
export async function pollTransaction(
  client: Pick<WalletsClient, "getTransaction">,
  opts: PollTransactionOptions,
): Promise<CircleTransactionResource> {
  requireString(opts.id, "pollTransaction.id");
  const attempts = opts.attempts ?? DEFAULT_POLL_ATTEMPTS;
  const delayMs = opts.delayMs ?? DEFAULT_POLL_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;

  let lastState: CircleTransactionState | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const tx = await client.getTransaction(opts.id);
    lastState = tx.state;

    if (tx.state === "COMPLETE") return tx;

    if (TERMINAL_FAILURE_STATES.has(tx.state)) {
      throw new SettleKitError({
        code: "integration_error",
        message: `Transaction ${opts.id} reached terminal failure state ${tx.state}`,
        details: {
          id: opts.id,
          state: tx.state,
          errorReason: tx.errorReason,
          errorDetails: tx.errorDetails,
        },
      });
    }

    const isLastAttempt = attempt === attempts - 1;
    if (!isLastAttempt) await sleep(delayMs);
  }

  throw new SettleKitError({
    code: "integration_error",
    message: `Transaction ${opts.id} did not reach a terminal state within ${attempts} attempts`,
    retryable: true,
    details: { id: opts.id, state: lastState, attempts },
  });
}
