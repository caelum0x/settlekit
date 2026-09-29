/**
 * Business events the operator reacts to, plus a boundary validator.
 *
 * Amounts are USDC base units (bigint). `parseOperatorEvent` accepts untrusted
 * JSON (amounts as base-unit integer strings) and returns a typed, frozen
 * event or throws `EventValidationError` listing every problem.
 */

interface EventBase {
  readonly id: string;
  readonly orgId: string;
  /** ISO-8601 time the event occurred. */
  readonly at: string;
}

export interface RevenueReceived extends EventBase {
  readonly type: "revenue.received";
  readonly amount: bigint;
  readonly payer: string;
  /** Payment reference (tx hash / checkout session id). */
  readonly paymentRef: string;
}

export interface BillDue extends EventBase {
  readonly type: "bill.due";
  readonly billId: string;
  readonly payee: string;
  readonly amount: bigint;
  readonly dueAt: string;
  readonly description: string;
}

export interface RefundRequested extends EventBase {
  readonly type: "refund.requested";
  readonly customer: string;
  readonly amount: bigint;
  readonly paymentRef: string;
  readonly reason: string;
}

export interface DisputeOpened extends EventBase {
  readonly type: "dispute.opened";
  readonly disputeId: string;
  readonly customer: string;
  readonly amount: bigint;
  readonly paymentRef: string;
}

export interface Tick extends EventBase {
  readonly type: "tick";
}

export type OperatorEvent = RevenueReceived | BillDue | RefundRequested | DisputeOpened | Tick;
export type OperatorEventType = OperatorEvent["type"];

export const EVENT_TYPES: readonly OperatorEventType[] = [
  "revenue.received",
  "bill.due",
  "refund.requested",
  "dispute.opened",
  "tick",
];

export class EventValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid operator event: ${issues.join("; ")}`);
    this.name = "EventValidationError";
    this.issues = issues;
  }
}

type Raw = Record<string, unknown>;

const STRING_FIELDS: Readonly<Record<OperatorEventType, readonly string[]>> = {
  "revenue.received": ["payer", "paymentRef"],
  "bill.due": ["billId", "payee", "description"],
  "refund.requested": ["customer", "paymentRef", "reason"],
  "dispute.opened": ["disputeId", "customer", "paymentRef"],
  tick: [],
};

const DATE_FIELDS: Readonly<Record<OperatorEventType, readonly string[]>> = {
  "revenue.received": [],
  "bill.due": ["dueAt"],
  "refund.requested": [],
  "dispute.opened": [],
  tick: [],
};

/** Validate untrusted input into a typed operator event. */
export function parseOperatorEvent(input: unknown): OperatorEvent {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new EventValidationError(["event must be an object"]);
  }
  const raw = input as Raw;
  const type = raw.type;
  if (typeof type !== "string" || !EVENT_TYPES.includes(type as OperatorEventType)) {
    throw new EventValidationError([`unknown event type ${JSON.stringify(type)}`]);
  }
  const eventType = type as OperatorEventType;
  const issues: string[] = [];
  const out: Record<string, unknown> = { type: eventType };

  for (const field of ["id", "orgId", ...STRING_FIELDS[eventType]]) {
    const value = raw[field];
    if (typeof value !== "string" || value.trim().length === 0) issues.push(`${field} must be a non-empty string`);
    else out[field] = value;
  }
  for (const field of ["at", ...DATE_FIELDS[eventType]]) {
    const value = raw[field];
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) issues.push(`${field} must be an ISO timestamp`);
    else out[field] = new Date(value).toISOString();
  }
  if (eventType !== "tick") {
    const amount = parseAmount(raw.amount);
    if (amount === null) issues.push("amount must be a positive base-unit integer");
    else out.amount = amount;
  }
  if (issues.length > 0) throw new EventValidationError(issues);
  return Object.freeze(out) as unknown as OperatorEvent;
}

function parseAmount(value: unknown): bigint | null {
  if (typeof value === "bigint") return value > 0n ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  return null;
}
