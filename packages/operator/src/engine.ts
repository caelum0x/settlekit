/**
 * OperatorAgent — Claude decides, the deterministic HeuristicOperator backs it up.
 *
 * `ClaudeOperator` drives the Anthropic SDK tool runner over the operator
 * tools (./tools.ts): routine revenue/tick events use the routine model,
 * bills, refunds and disputes the critical model; at most 12 iterations. The
 * decision is the set of policy-checked proposals the model made, plus the
 * full tool trace and token cost. `OperatorAgent` falls back to the
 * heuristic engine when no client is configured or the model call fails.
 */
import Anthropic from "@anthropic-ai/sdk";
import { proposal } from "./actions.js";
import { eventCounterparty, riskInputs, type DecisionEngine, type EngineContext, type EngineDecision } from "./context.js";
import { digest, type DecisionUsage, type ToolCallRecord } from "./decision-log.js";
import type { OperatorEvent } from "./events.js";
import { HEURISTIC_MODEL, HeuristicOperator } from "./heuristic.js";
import { eventMessage, OPERATOR_SYSTEM_PROMPT } from "./prompts.js";
import { ToolSession } from "./tool-session.js";
import { buildOperatorTools } from "./tools.js";

export const DEFAULT_ROUTINE_MODEL = "claude-sonnet-5";
export const DEFAULT_CRITICAL_MODEL = "claude-opus-5-5";
export const MAX_ITERATIONS = 12;

/** USD per million tokens (Anthropic first-party list prices). */
export const MODEL_PRICING: Readonly<Record<string, { readonly input: number; readonly output: number }>> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export interface ModelRouting {
  readonly routine: string;
  readonly critical: string;
}

const CRITICAL_EVENTS: ReadonlySet<OperatorEvent["type"]> = new Set(["bill.due", "refund.requested", "dispute.opened"]);

export function modelFor(event: OperatorEvent, models: ModelRouting): string {
  return CRITICAL_EVENTS.has(event.type) ? models.critical : models.routine;
}

interface RawUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
}

/** Cost of one response; cache writes bill at 1.25x input, reads at 0.1x. */
export function usageCost(model: string, u: RawUsage): DecisionUsage {
  const price = MODEL_PRICING[model] ?? { input: 0, output: 0 };
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const inputEquivalent = u.input_tokens + write * 1.25 + read * 0.1;
  const costUsd = (inputEquivalent * price.input + u.output_tokens * price.output) / 1_000_000;
  return { inputTokens: u.input_tokens + write + read, outputTokens: u.output_tokens, costUsd };
}

export function addUsage(a: DecisionUsage, b: DecisionUsage): DecisionUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: Math.round((a.costUsd + b.costUsd) * 1e8) / 1e8,
  };
}

const ZERO_USAGE: DecisionUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

function inputsDigestOf(event: OperatorEvent, ctx: EngineContext): string {
  return digest({ event, policy: ctx.policy, vault: ctx.vault, now: ctx.now.toISOString() });
}

export interface ClaudeOperatorOptions {
  readonly client: Anthropic;
  readonly models?: Partial<ModelRouting>;
  readonly maxIterations?: number;
  readonly maxTokens?: number;
}

export class ClaudeOperator implements DecisionEngine {
  readonly name = "claude";
  private readonly models: ModelRouting;
  private readonly maxIterations: number;
  private readonly maxTokens: number;

  constructor(private readonly options: ClaudeOperatorOptions) {
    this.models = {
      routine: options.models?.routine ?? DEFAULT_ROUTINE_MODEL,
      critical: options.models?.critical ?? DEFAULT_CRITICAL_MODEL,
    };
    this.maxIterations = Math.min(MAX_ITERATIONS, Math.max(1, options.maxIterations ?? MAX_ITERATIONS));
    this.maxTokens = options.maxTokens ?? 8000;
  }

  async decide(event: OperatorEvent, ctx: EngineContext): Promise<EngineDecision> {
    const model = modelFor(event, this.models);
    const session = new ToolSession(event, ctx);
    const runner = this.options.client.beta.messages.toolRunner({
      model,
      max_tokens: this.maxTokens,
      max_iterations: this.maxIterations,
      system: [{ type: "text", text: OPERATOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: eventMessage(event, ctx.orgId, ctx.now) }],
      tools: buildOperatorTools(session),
    });
    let usage = ZERO_USAGE;
    let stopReason: string | null = null;
    for await (const message of runner) {
      usage = addUsage(usage, usageCost(model, message.usage));
      stopReason = message.stop_reason;
    }
    const ended: ToolCallRecord = { name: "model_stop", input: { model }, output: { stopReason } };
    const proposals = session.proposals.length > 0
      ? session.proposals
      : [proposal({ kind: "defer", reason: "model finished without an action" }, `The model stopped (${stopReason ?? "unknown"}) without proposing an action; nothing was executed.`, ["retry on the next tick"], 0.5)];
    return { model, inputsDigest: inputsDigestOf(event, ctx), proposals, toolCalls: [...session.toolCalls, ended], usage };
  }
}

/** The deterministic engine, with counterparty screening for spend events. */
export class HeuristicEngine implements DecisionEngine {
  readonly name = "heuristic";
  private readonly operator = new HeuristicOperator();

  async decide(event: OperatorEvent, ctx: EngineContext): Promise<EngineDecision> {
    const counterparty = event.type === "revenue.received" ? null : eventCounterparty(event);
    const amount = "amount" in event ? event.amount : 0n;
    const assessment = counterparty && ctx.screener ? await ctx.screener.assess(ctx.orgId, counterparty, amount, ctx.now) : null;
    const decision = this.operator.decide(event, {
      policy: ctx.policy,
      vault: ctx.vault,
      now: ctx.now,
      x402PurchasesToday: ctx.x402PurchasesToday,
      ...riskInputs(assessment),
    });
    const toolCalls: ToolCallRecord[] = assessment
      ? [{ name: "get_counterparty_risk", input: { address: counterparty }, output: assessment }]
      : [];
    return { model: decision.model, inputsDigest: decision.inputsDigest, proposals: decision.proposals, toolCalls };
  }
}

export interface OperatorAgentOptions {
  readonly claude?: DecisionEngine;
  readonly heuristic?: DecisionEngine;
  readonly onFallback?: (error: unknown) => void;
}

export class OperatorAgent implements DecisionEngine {
  readonly name: string;
  private readonly heuristic: DecisionEngine;

  constructor(private readonly options: OperatorAgentOptions = {}) {
    this.heuristic = options.heuristic ?? new HeuristicEngine();
    this.name = options.claude ? "claude+heuristic" : "heuristic";
  }

  async decide(event: OperatorEvent, ctx: EngineContext): Promise<EngineDecision> {
    if (!this.options.claude) return this.heuristic.decide(event, ctx);
    try {
      return await this.options.claude.decide(event, ctx);
    } catch (error) {
      this.options.onFallback?.(error);
      const fallback = await this.heuristic.decide(event, ctx);
      const note: ToolCallRecord = {
        name: "engine_fallback",
        input: { from: "claude", to: HEURISTIC_MODEL },
        output: { error: error instanceof Error ? error.message : String(error) },
      };
      return { ...fallback, toolCalls: [note, ...fallback.toolCalls] };
    }
  }
}

export interface CreateAgentOptions {
  readonly apiKey?: string;
  readonly client?: Anthropic;
  readonly models?: Partial<ModelRouting>;
  readonly maxIterations?: number;
  readonly onFallback?: (error: unknown) => void;
}

/** Claude when a key or client is supplied, otherwise heuristic-only. */
export function createOperatorAgent(options: CreateAgentOptions = {}): OperatorAgent {
  const client = options.client ?? (options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : undefined);
  const claude = client
    ? new ClaudeOperator({ client, models: options.models, maxIterations: options.maxIterations })
    : undefined;
  return new OperatorAgent({ claude, onFallback: options.onFallback });
}
