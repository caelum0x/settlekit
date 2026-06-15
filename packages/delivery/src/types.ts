/**
 * Core domain types for the delivery action engine (plan §21).
 *
 * A {@link DeliveryRunner} executes the ordered actions of a {@link DeliveryPlan}
 * after a payment confirms. Each action is handled by an {@link ActionHandler}
 * registered in a {@link import("./registry.js").HandlerRegistry}. Handlers
 * receive a {@link DeliveryContext} carrying the purchase facts plus the
 * injected external {@link DeliveryClients}.
 */

import type {
  DeliveryAction,
  DeliveryActionType,
  DeliveryLog,
} from "@settlekit/common";
import type { DeliveryClients } from "./clients.js";

/** The output payload a handler returns; stored on the action run. */
export type ActionOutput = Record<string, unknown>;

/**
 * Facts about the purchase plus the injected clients. One context is built per
 * `run` call and shared (read-only) by every action handler.
 */
export interface DeliveryContext {
  organizationId: string;
  customerId: string;
  productId: string;
  paymentId: string;
  /** Entitlement id minted for this delivery (links grants back to the buyer). */
  entitlementId: string;
  /** GitHub App installation id, when the org has connected GitHub. */
  githubInstallationId?: number;
  /** The purchaser's GitHub login, resolved at checkout. */
  githubUsername?: string;
  /** The purchaser's Discord user id, resolved at checkout. */
  discordUserId?: string;
  /** Destination email for `email_send` actions. */
  customerEmail?: string;
  /** Free-form template variables forwarded to the email sender. */
  emailVariables?: Record<string, unknown>;
  /** The injected external service clients. */
  clients: DeliveryClients;
}

/**
 * A handler knows how to {@link execute} a single action type and (optionally)
 * how to {@link rollback} a previously successful one. Handlers are pure with
 * respect to the run: they never mutate the context or run snapshots.
 */
export interface ActionHandler<A extends DeliveryAction = DeliveryAction> {
  /** The discriminant this handler is registered under. */
  readonly type: A["type"];
  /** Perform the side effect and return a JSON-serializable output. */
  execute(action: A, ctx: DeliveryContext): Promise<ActionOutput>;
  /**
   * Best-effort undo of a previously successful {@link execute}. Receives the
   * exact output that execute returned. Omit when the action is irreversible.
   */
  rollback?(action: A, output: ActionOutput, ctx: DeliveryContext): Promise<void>;
}

/** Narrows the action union to the member with the given discriminant. */
export type ActionOfType<T extends DeliveryActionType> = Extract<
  DeliveryAction,
  { type: T }
>;

/** Sink for {@link DeliveryLog} entries emitted while a run executes. */
export interface DeliveryLogger {
  log(entry: DeliveryLog): void;
}

/** Tuning for per-action retry backoff. All times in milliseconds. */
export interface RetryPolicy {
  /** Total attempts per action, including the first. Must be >= 1. */
  maxAttempts: number;
  /** Base delay before the first retry. */
  baseDelayMs: number;
  /** Multiplier applied to the delay after each failed attempt. */
  factor: number;
  /** Upper bound on any single backoff delay. */
  maxDelayMs: number;
}

/** Sensible production defaults: 3 attempts, exponential backoff capped at 10s. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 200,
  factor: 2,
  maxDelayMs: 10_000,
};

/** Options accepted by {@link DeliveryRunner}. */
export interface DeliveryRunnerOptions {
  logger?: DeliveryLogger;
  retry?: Partial<RetryPolicy>;
  /**
   * Sleep implementation, injectable for tests so backoff does not slow the
   * suite. Defaults to a real `setTimeout`-based delay.
   */
  sleep?: (ms: number) => Promise<void>;
  /** Clock, injectable for deterministic timestamps in tests. */
  now?: () => Date;
}
