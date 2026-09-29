import Anthropic from "@anthropic-ai/sdk";
import type { OperatorEvent } from "../src/events.js";
import { EscalationQueue, type EscalationEvent, type Escalation } from "../src/escalation.js";
import type { DecisionEngine, X402Gateway } from "../src/context.js";
import { createStoreHistory } from "../src/history.js";
import { LocalExecutor } from "../src/local-executor.js";
import { OperatorService } from "../src/service.js";
import { InMemoryOperatorStore } from "../src/store.js";
import type { OperatorPolicy } from "../src/policy.js";
import { DAILY, ESCALATE_ABOVE, PER_TX, POLICY, T0, U, VENDOR } from "./fixtures.js";

export interface ScriptedToolUse {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** One scripted model turn: tool calls, or final text when empty. */
export type ScriptedTurn = readonly ScriptedToolUse[] | { readonly text: string; readonly stop?: string };

export interface ScriptedClient {
  readonly client: Anthropic;
  /** Parsed JSON bodies of every request the SDK sent. */
  readonly requests: Array<Record<string, any>>;
}

/**
 * A real Anthropic SDK client whose fetch replays scripted Messages API
 * responses, so the SDK tool runner, betaZodTool parsing and tool_result
 * plumbing all run for real. After the script is exhausted it ends the turn.
 */
export function scriptedAnthropic(script: readonly ScriptedTurn[], options: { failWith?: number } = {}): ScriptedClient {
  const requests: Array<Record<string, any>> = [];
  let turn = 0;
  const fetchImpl = async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
    requests.push(body);
    if (options.failWith) {
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), {
        status: options.failWith,
        headers: { "content-type": "application/json" },
      });
    }
    const step = script[turn] ?? { text: "Done." };
    turn += 1;
    const content = Array.isArray(step)
      ? (step as readonly ScriptedToolUse[]).map((t, i) => ({ type: "tool_use", id: `toolu_${turn}_${i}`, name: t.name, input: t.input }))
      : [{ type: "text", text: (step as { text: string }).text }];
    const stop = Array.isArray(step) ? "tool_use" : ((step as { stop?: string }).stop ?? "end_turn");
    const message = {
      id: `msg_${turn}`,
      type: "message",
      role: "assistant",
      model: body.model,
      content,
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new Anthropic({ apiKey: "test-key", maxRetries: 0, fetch: fetchImpl as unknown as typeof fetch });
  return { client, requests };
}

export const REASONING = {
  rationale: "Grounded in the treasury state.",
  alternatives_considered: ["defer"],
  confidence: 0.9,
};

export interface Harness {
  readonly store: InMemoryOperatorStore;
  readonly vault: LocalExecutor;
  readonly service: OperatorService;
  readonly notifications: Array<{ id: string; event: EscalationEvent }>;
  clock: Date;
}

export interface HarnessOptions {
  readonly engine: DecisionEngine;
  readonly policy?: OperatorPolicy;
  readonly x402?: X402Gateway;
  readonly deposit?: bigint;
  readonly allowlist?: readonly string[];
}

export function harness(options: HarnessOptions): Harness {
  const store = new InMemoryOperatorStore();
  const state = { clock: T0 };
  const now = (): Date => state.clock;
  const vault = new LocalExecutor({
    caps: { perTxCap: PER_TX, dailyCap: DAILY, escalateAbove: ESCALATE_ABOVE },
    allowlist: options.allowlist ?? [VENDOR],
    yieldEnabled: true,
    now,
  });
  if (options.deposit) vault.deposit(options.deposit);
  const notifications: Array<{ id: string; event: EscalationEvent }> = [];
  const escalations = new EscalationQueue(store, {
    now,
    notify: async (e: Escalation, event: EscalationEvent) => {
      notifications.push({ id: e.id, event });
    },
  });
  let n = 0;
  const service = new OperatorService({
    store,
    executor: vault,
    owner: vault,
    policy: { get: async () => options.policy ?? POLICY },
    engine: options.engine,
    escalations,
    history: createStoreHistory(store),
    x402: options.x402,
    now,
    newId: (prefix) => `${prefix}_${++n}`,
  });
  const h = { store, vault, service, notifications } as Harness;
  Object.defineProperty(h, "clock", { get: () => state.clock, set: (d: Date) => { state.clock = d; } });
  return h;
}

export function revenue(amount: bigint, extra: Partial<Record<string, unknown>> = {}): OperatorEvent {
  return { type: "revenue.received", id: "evt_rev_1", orgId: "org_1", at: T0.toISOString(), amount, payer: "0x00000000000000000000000000000000000000aa", paymentRef: "0xpay1", ...extra } as OperatorEvent;
}

export function billDue(billId: string, payee: string, amount: bigint, description = "Hosting, September"): OperatorEvent {
  return { type: "bill.due", id: `evt_${billId}`, orgId: "org_1", at: T0.toISOString(), billId, payee, amount, dueAt: T0.toISOString(), description };
}

export const usdc = (n: number): bigint => BigInt(n) * U;
