/**
 * ERC-8004 domain types: agent identity, reputation feedback, and the
 * request/response validation flow. Kept free of any chain library so the
 * package depends only on `@settlekit/common`; the chain details live behind
 * the injected {@link Erc8004Port}.
 */

/** An agent's on-chain identity. */
export interface AgentIdentity {
  /** ERC-721 token id minted by the IdentityRegistry. */
  agentId: string;
  /** Wallet that owns the identity. */
  owner: string;
  /** Metadata URI (e.g. an IPFS document describing the agent). */
  metadataUri: string;
}

/** Outcome of a state-changing call. */
export interface TxResult {
  txHash: string;
  explorerUrl?: string;
}

/** Reputation feedback recorded by a validator (never the agent's owner). */
export interface FeedbackInput {
  agentId: string;
  /** Score (contract type int128); convention is 0–100. */
  score: number;
  /** Feedback category (contract type uint8). Default 0. */
  feedbackType?: number;
  /** Short machine tag, e.g. "successful_trade". */
  tag: string;
  metadataUri?: string;
  evidenceUri?: string;
  comment?: string;
}

/** A request for a validator to attest something about an agent. */
export interface ValidationRequestInput {
  agentId: string;
  /** Validator wallet address that will respond. */
  validator: string;
  /** URI describing what is being validated. */
  requestUri: string;
  /**
   * Stable subject string the port hashes into the on-chain request handle.
   * The same subject reproduces the same handle, so status can be looked up.
   */
  subject: string;
}

/** Handle to a submitted validation request. */
export interface ValidationRequestResult extends TxResult {
  /** The on-chain request hash, used to read status later. */
  requestHash: string;
}

/** A validator's response to a request. */
export interface ValidationResponseInput {
  requestHash: string;
  /** 0–100; 100 = passed. */
  response: number;
  responseUri?: string;
  tag?: string;
}

/** Current status of a validation request. */
export interface ValidationStatus {
  validator: string;
  agentId: string;
  /** 0–100 response; 0 when not yet answered. */
  response: number;
  tag: string;
  /** Convenience: true when {@link ValidationStatus.response} indicates a pass. */
  passed: boolean;
}
