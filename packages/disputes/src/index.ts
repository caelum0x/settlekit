export * from "./types.js";
export * from "./dispute.js";
export * from "./store.js";
export * from "./service.js";

// --- Legacy API (preserved for existing callers) -------------------------
// The legacy Dispute/DisputeStatus/openDispute symbols are superseded by the
// spec engine above; their original implementations remain available under
// namespaced names plus the still-exported submitDisputeEvidence helper.
export {
  type LegacyDispute,
  type LegacyDisputeStatus,
  legacyOpenDispute,
  submitDisputeEvidence,
} from "./legacy.js";
