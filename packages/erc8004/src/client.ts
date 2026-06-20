/**
 * {@link AgentRegistryClient} — the SettleKit-idiomatic facade over an injected
 * {@link Erc8004Port}. Every method validates its request, calls the port, and
 * returns a `Result` instead of throwing, so callers handle success/failure
 * uniformly. Mirrors app-kit's `ArcPaymentClient`.
 */

import { type Result, SettleKitError, err, ok } from "@settlekit/common";
import type { Erc8004Port } from "./port.js";
import type {
  AgentIdentity,
  FeedbackInput,
  TxResult,
  ValidationRequestInput,
  ValidationRequestResult,
  ValidationResponseInput,
  ValidationStatus,
} from "./types.js";
import {
  firstError,
  validateAddress,
  validateIntInRange,
  validateNonEmpty,
  validateScore,
} from "./validate.js";

/** Default feedback category when a request omits one. */
const DEFAULT_FEEDBACK_TYPE = 0;

/** Inclusive bounds for the uint8 `feedbackType` field. */
const FEEDBACK_TYPE_MIN = 0;
const FEEDBACK_TYPE_MAX = 255;

/** Inclusive bounds for the uint8 validation `response` field (0..100). */
const RESPONSE_MIN = 0;
const RESPONSE_MAX = 100;

/** Configuration for an {@link AgentRegistryClient}. */
export interface AgentRegistryClientConfig {
  /** The injected ERC-8004 port (viem/Circle DCW impl, or {@link LocalErc8004Port}). */
  port: Erc8004Port;
}

export class AgentRegistryClient {
  private readonly port: Erc8004Port;

  constructor(config: AgentRegistryClientConfig) {
    this.port = config.port;
  }

  /** Wrap a port call, mapping thrown errors to a typed integration error. */
  private async run<T>(op: string, call: () => Promise<T>): Promise<Result<T>> {
    try {
      const value = await call();
      return ok(value);
    } catch (cause) {
      return err(
        new SettleKitError({
          code: "integration_error",
          message: `erc8004 ${op} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          retryable: true,
          cause,
          details: { op },
        }),
      );
    }
  }

  /** Mint a new agent identity with the given metadata URI. */
  async registerAgent(input: { metadataUri: string }): Promise<Result<TxResult>> {
    const invalid = firstError(validateNonEmpty(input.metadataUri, "metadataUri"));
    if (invalid !== null) return err(invalid);

    return this.run("register", () => this.port.register({ metadataUri: input.metadataUri }));
  }

  /**
   * Resolve an owner's agent identity. Returns `ok(null)` when the owner has no
   * registered agent.
   */
  async resolveAgent(input: { owner: string }): Promise<Result<AgentIdentity | null>> {
    const invalid = firstError(validateAddress(input.owner, "owner"));
    if (invalid !== null) return err(invalid);

    return this.run("resolveAgent", async () => {
      const agentId = await this.port.findAgentId({ owner: input.owner });
      if (agentId === null) return null;
      const [owner, metadataUri] = await Promise.all([
        this.port.ownerOf({ agentId }),
        this.port.tokenUri({ agentId }),
      ]);
      const identity: AgentIdentity = { agentId, owner, metadataUri };
      return identity;
    });
  }

  /** Record reputation feedback about an agent. */
  async giveFeedback(input: FeedbackInput): Promise<Result<TxResult>> {
    const feedbackType = input.feedbackType ?? DEFAULT_FEEDBACK_TYPE;
    const invalid = firstError(
      validateNonEmpty(input.agentId, "agentId"),
      validateScore(input.score),
      validateIntInRange(feedbackType, FEEDBACK_TYPE_MIN, FEEDBACK_TYPE_MAX, "feedbackType"),
      validateNonEmpty(input.tag, "tag"),
    );
    if (invalid !== null) return err(invalid);

    return this.run("giveFeedback", () =>
      this.port.giveFeedback({ ...input, feedbackType }),
    );
  }

  /** Submit a validation request; the port derives the request hash. */
  async requestValidation(
    input: ValidationRequestInput,
  ): Promise<Result<ValidationRequestResult>> {
    const invalid = firstError(
      validateNonEmpty(input.agentId, "agentId"),
      validateAddress(input.validator, "validator"),
      validateNonEmpty(input.requestUri, "requestUri"),
      validateNonEmpty(input.subject, "subject"),
    );
    if (invalid !== null) return err(invalid);

    return this.run("requestValidation", () => this.port.requestValidation(input));
  }

  /** Submit a validator's response to a prior request. */
  async respondValidation(input: ValidationResponseInput): Promise<Result<TxResult>> {
    const invalid = firstError(
      validateNonEmpty(input.requestHash, "requestHash"),
      validateIntInRange(input.response, RESPONSE_MIN, RESPONSE_MAX, "response"),
    );
    if (invalid !== null) return err(invalid);

    return this.run("respondValidation", () => this.port.respondValidation(input));
  }

  /** Read the current status of a validation request by its hash. */
  async getValidationStatus(input: {
    requestHash: string;
  }): Promise<Result<ValidationStatus>> {
    const invalid = firstError(validateNonEmpty(input.requestHash, "requestHash"));
    if (invalid !== null) return err(invalid);

    return this.run("getValidationStatus", () =>
      this.port.getValidationStatus({ requestHash: input.requestHash }),
    );
  }
}
