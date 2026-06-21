// Local mirror of the live API row shapes for the agent economy
// (`/v1/agents`, `/v1/jobs`). These mirror @settlekit/persistence's
// agent-economy-store so lib/api.ts and the pages can type the live API rows
// without taking a runtime dependency on the persistence package (which is not
// a dependency of agent-console). Keep in sync with
// packages/persistence/src/agent-economy-store.ts.

/** Job lifecycle status (mirrors @settlekit/erc8183 + the API state machine). */
export type JobStatus =
  | "created"
  | "funded"
  | "submitted"
  | "evaluated"
  | "settled"
  | "refunded"
  | "cancelled";

/** A registered agent identity record returned by `/v1/agents`. */
export interface AgentRecord {
  id: string;
  organizationId: string;
  owner: string;
  metadataUri: string;
  displayName?: string;
  /** Average reputation score (0–100) across recorded feedback. */
  reputationScore?: number;
  /** Number of feedback entries recorded. */
  reputationCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** An agent job record returned by `/v1/jobs`. */
export interface JobRecord {
  id: string;
  organizationId: string;
  requester: string;
  worker: string;
  amountUsdc: string;
  status: JobStatus;
  deliverableUri?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Forward-only "advance" path for the AdvanceJobButton, mirroring the legal
 * happy-path transitions enforced by the API's NEXT state machine
 * (apps/api/src/routes/jobs.ts): created → funded → submitted → evaluated →
 * settled. Statuses absent from this map (settled/refunded/cancelled) are
 * terminal for the purposes of the advance control.
 */
export const NEXT_STATUS: Readonly<Partial<Record<JobStatus, JobStatus>>> = {
  created: "funded",
  funded: "submitted",
  submitted: "evaluated",
  evaluated: "settled",
};

/** Terminal job states — the advance control is disabled on these. */
export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "settled",
  "refunded",
  "cancelled",
]);

/** The next forward status for the advance control, or null if terminal. */
export function nextStatus(status: JobStatus): JobStatus | null {
  return NEXT_STATUS[status] ?? null;
}

/** True when a job can no longer be advanced (terminal or no forward edge). */
export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status) || nextStatus(status) === null;
}

/** Decimal-USDC validation matching the API's `^\d+(\.\d{1,6})?$` regex. */
export const AMOUNT_USDC_RE = /^\d+(\.\d{1,6})?$/;
