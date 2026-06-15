import type { EscrowStatus } from "@settlekit/common";
import { conflict } from "@settlekit/common";
import type { EscrowTransition } from "./types.js";

/**
 * The legal transition table for the escrow lifecycle (plan §12, §24).
 *
 * Read as: from `source` status, applying `transition` yields the target
 * status. Any (source, transition) pair not present here is illegal and is
 * rejected by {@link assertTransition} with a `conflict` (HTTP 409) error.
 *
 * Lifecycle (happy path):
 *   created -> funded -> assigned -> submitted -> approved -> released
 *
 * Branches:
 *   - refund is permitted from any pre-release working state.
 *   - a dispute may be opened from funded/assigned/submitted/approved.
 *   - a dispute resolves to either released or refunded.
 *
 * Terminal states (released, refunded) have no outgoing transitions.
 */
export const ESCROW_TRANSITIONS: Readonly<
  Record<EscrowStatus, Readonly<Partial<Record<EscrowTransition, EscrowStatus>>>>
> = {
  created: {
    fund: "funded",
    refund: "refunded",
  },
  funded: {
    assign: "assigned",
    refund: "refunded",
    open_dispute: "disputed",
  },
  assigned: {
    submit: "submitted",
    refund: "refunded",
    open_dispute: "disputed",
  },
  submitted: {
    approve: "approved",
    refund: "refunded",
    open_dispute: "disputed",
  },
  approved: {
    release: "released",
    open_dispute: "disputed",
  },
  disputed: {
    resolve_dispute_release: "released",
    resolve_dispute_refund: "refunded",
  },
  released: {},
  refunded: {},
};

/** Return the target status for a transition, or `undefined` if illegal. */
export function peekTransition(
  status: EscrowStatus,
  transition: EscrowTransition,
): EscrowStatus | undefined {
  return ESCROW_TRANSITIONS[status][transition];
}

/** Whether `transition` is legal from the given `status`. */
export function canTransition(status: EscrowStatus, transition: EscrowTransition): boolean {
  return peekTransition(status, transition) !== undefined;
}

/**
 * Guard the escrow state machine: resolve the target status for a transition or
 * throw a `conflict` {@link import("@settlekit/common").SettleKitError} (HTTP
 * 409) describing the illegal move. This is the single enforcement point every
 * transition helper funnels through.
 */
export function assertTransition(
  status: EscrowStatus,
  transition: EscrowTransition,
): EscrowStatus {
  const next = peekTransition(status, transition);
  if (next === undefined) {
    throw conflict(
      `Illegal escrow transition "${transition}" from status "${status}".`,
      { from: status, transition },
    );
  }
  return next;
}

/**
 * Resolve the next status for a transition, throwing `conflict` on an illegal
 * move. Retained as the canonical name used by the transition helpers.
 */
export function nextEscrowStatus(
  status: EscrowStatus,
  transition: EscrowTransition,
): EscrowStatus {
  return assertTransition(status, transition);
}

/** Whether a status is terminal (no further transitions are possible). */
export function isTerminalStatus(status: EscrowStatus): boolean {
  return Object.keys(ESCROW_TRANSITIONS[status]).length === 0;
}
