/**
 * The Claude decision engine — the agent's real brain.
 *
 * It exposes the capability surface as tools to Claude (claude-opus-4-8) via the
 * official Anthropic SDK tool runner and lets the model decide, turn by turn,
 * which services to discover, evaluate, pay for, and rate under its budget. The
 * model drives the trajectory; the runner executes the tool calls; the
 * capability layer enforces the spend policy regardless of what Claude decides.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import type { AgentCapabilities, DecisionEngine } from "./types.js";

/** The most capable Claude model; the default brain for the agent. */
export const DEFAULT_AGENT_MODEL = "claude-opus-4-8";

/** Options for {@link ClaudeDecisionEngine}. */
export interface ClaudeEngineOptions {
  /** Pre-constructed client. Defaults to `new Anthropic()` (reads env). */
  client?: Anthropic;
  /** Model id. Defaults to {@link DEFAULT_AGENT_MODEL}. */
  model?: string;
  /** Max tool-loop iterations. Defaults to 24. */
  maxIterations?: number;
  /** Max tokens per response. Defaults to 4096. */
  maxTokens?: number;
}

function systemPrompt(capabilities: AgentCapabilities): string {
  const { policy } = capabilities;
  const lines = [
    "You are an autonomous purchasing agent operating in a nanopayment marketplace.",
    "Services are priced per call in USDC and gated behind the x402 protocol; you pay the toll to read the result.",
    "",
    "Your job: accomplish the user's objective by discovering services, judging which are worth paying for, paying the toll, using the result, and rating each service afterwards.",
    "",
    "Budget and policy (hard limits — the tools enforce them, so a refusal means you hit a limit, not a bug):",
    `- Total budget: ${policy.totalBudgetUsdc} USDC for this run.`,
    policy.maxPriceUsdc !== undefined ? `- Per-call cap: ${policy.maxPriceUsdc} USDC.` : "",
    policy.maxPurchases !== undefined ? `- At most ${policy.maxPurchases} paid calls.` : "",
    policy.minReputation !== undefined
      ? `- Avoid services rated below ${policy.minReputation}/5 once they have ratings.`
      : "",
    "",
    "How to work:",
    "- Call discover_services first. Prefer higher reputation and lower price when results are comparable.",
    "- Call pay_and_call to buy a service; read its returned content to make progress on the objective.",
    "- After using a service, call rate_service (1-5) reflecting how useful the content was.",
    "- Check_status to track remaining budget. Stop once the objective is met or the budget is nearly spent.",
    "- Spend deliberately: only buy what advances the objective. Do not exhaust the budget for its own sake.",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

export class ClaudeDecisionEngine implements DecisionEngine {
  readonly name = "claude";
  private readonly options: ClaudeEngineOptions;

  constructor(options: ClaudeEngineOptions = {}) {
    this.options = options;
  }

  async run(capabilities: AgentCapabilities): Promise<void> {
    const client = this.options.client ?? new Anthropic();

    const tools = [
      betaZodTool({
        name: "discover_services",
        description:
          "List marketplace services matching an optional text query. Returns id, price (USDC), endpoint, and reputation.",
        inputSchema: z.object({ query: z.string().optional() }),
        run: async ({ query }) =>
          JSON.stringify(
            await capabilities.discover(
              query !== undefined && query.length > 0 ? { text: query } : undefined,
            ),
          ),
      }),
      betaZodTool({
        name: "check_status",
        description: "Return remaining budget, amount spent, and number of paid calls so far.",
        inputSchema: z.object({}),
        run: async () => JSON.stringify(capabilities.status()),
      }),
      betaZodTool({
        name: "pay_and_call",
        description:
          "Pay the x402 toll for a service and return its content. Refuses (ok:false with a reason) if it would exceed the budget, the per-call cap, or the reputation floor.",
        inputSchema: z.object({ serviceId: z.string() }),
        run: async ({ serviceId }) => JSON.stringify(await capabilities.buy(serviceId)),
      }),
      betaZodTool({
        name: "rate_service",
        description: "Record a 1-5 star rating for a service after using it.",
        inputSchema: z.object({ serviceId: z.string(), stars: z.number() }),
        run: async ({ serviceId, stars }) => {
          await capabilities.rate(serviceId, stars);
          return "rated";
        },
      }),
    ];

    const runner = client.beta.messages.toolRunner({
      model: this.options.model ?? DEFAULT_AGENT_MODEL,
      max_tokens: this.options.maxTokens ?? 4096,
      max_iterations: this.options.maxIterations ?? 24,
      system: systemPrompt(capabilities),
      messages: [{ role: "user", content: capabilities.objective }],
      tools,
    });

    await runner.runUntilDone();
  }
}
