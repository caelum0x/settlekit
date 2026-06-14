import type { EscrowStatus } from "@settlekit/common";
import type { EscrowTransition } from "./types.js";

const TRANSITIONS: Record<EscrowStatus, Partial<Record<EscrowTransition, EscrowStatus>>> = {
  created: { fund: "funded", refund: "refunded" },
  funded: { assign: "assigned", refund: "refunded", dispute: "disputed" },
  assigned: { submit: "submitted", refund: "refunded", dispute: "disputed" },
  submitted: { approve: "approved", refund: "refunded", dispute: "disputed" },
  approved: { release: "released" },
  released: {},
  refunded: {},
  disputed: {},
};

export function nextEscrowStatus(status: EscrowStatus, transition: EscrowTransition): EscrowStatus {
  const next = TRANSITIONS[status][transition];
  if (!next) throw new Error(`Cannot ${transition} escrow task in ${status} state`);
  return next;
}
