/**
 * The Claude allocation engine — the real reasoning brain.
 *
 * Claude (claude-opus-4-8) sees every dependency with its signals and the funding
 * philosophy, and decides how to weight the split via the official Anthropic SDK
 * tool runner. It can inspect candidates, preview the conserved plan a weighting
 * would produce, and refine — but it can only ever *propose weights*. The
 * capability layer still performs the conserved allocation, so the model exercises
 * judgement over a scarce budget while every invariant (sums to budget, only
 * resolvable wallets, nothing negative) is enforced in code. If the model never
 * proposes a weighting, we fall back to the deterministic heuristic scores.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import type { AllocationCapabilities, AllocationEngine, AllocationWeight } from "./allocation.js";
import { HeuristicAllocationEngine } from "./heuristic-allocator.js";
import type { FundingPlan } from "./types.js";

/** The most capable Claude model; the default brain for allocation. */
export const DEFAULT_ALLOCATOR_MODEL = "claude-opus-4-8";

/** Options for {@link ClaudeAllocationEngine}. */
export interface ClaudeAllocatorOptions {
  client?: Anthropic;
  model?: string;
  maxIterations?: number;
  maxTokens?: number;
}

function systemPrompt(capabilities: AllocationCapabilities): string {
  return [
    "You allocate a fixed monthly open-source funding budget across the maintainers of a project's dependencies.",
    "",
    "Funding philosophy:",
    capabilities.philosophy,
    "",
    `Total budget: ${capabilities.budget.amount} ${capabilities.budget.currency}.`,
    "",
    "Each candidate carries four signals:",
    "- directness (0-1): how directly the project depends on the package (1 = a direct dependency).",
    "- reach: how many other packages in the tree transitively depend on it (criticality / load-bearing).",
    "- usage: how heavily the project itself uses it.",
    "- underfunding (0-1): how little the maintainer already receives (1 = nothing known).",
    "- runtimeFactor: production code weighs more than dev-only tooling.",
    "",
    "How to work:",
    "- Call list_candidates to see every package and its signals.",
    "- Reason about which maintainers most deserve a larger share, then call propose_allocation with relative weights (any non-negative numbers; only ratios matter).",
    "- Call propose_allocation again to refine after seeing the resulting per-wallet plan.",
    "- Critical + underfunded + heavily-used production dependencies should receive the most. Do not split evenly.",
    "- When satisfied, stop. Your last proposal is the plan.",
  ].join("\n");
}

export class ClaudeAllocationEngine implements AllocationEngine {
  readonly name = "claude";
  private readonly options: ClaudeAllocatorOptions;

  constructor(options: ClaudeAllocatorOptions = {}) {
    this.options = options;
  }

  async decide(capabilities: AllocationCapabilities): Promise<FundingPlan> {
    const client = this.options.client ?? new Anthropic();
    let proposed: AllocationWeight[] | undefined;

    const tools = [
      betaZodTool({
        name: "list_candidates",
        description:
          "List every fundable package with its signals (directness, reach, usage, underfunding, runtimeFactor) and whether its maintainer wallet is claimed.",
        inputSchema: z.object({}),
        run: async () =>
          JSON.stringify(
            capabilities.candidates().map((c) => ({
              claimed: c.claimed,
              ...c.signals,
            })),
          ),
      }),
      betaZodTool({
        name: "propose_allocation",
        description:
          "Propose relative funding weights per package. Returns the conserved per-wallet plan that results, so you can refine. Sums to the budget exactly regardless of the weights you give.",
        inputSchema: z.object({
          weights: z.array(z.object({ name: z.string(), weight: z.number() })),
        }),
        run: async ({ weights }) => {
          proposed = weights;
          const plan = capabilities.allocate(weights, this.name);
          return JSON.stringify({
            legs: plan.legs.map((l) => ({
              wallet: l.wallet,
              amount: l.amount.amount,
              claimed: l.claimed,
              packages: l.packages,
            })),
            unclaimed: plan.unclaimed.amount,
          });
        },
      }),
    ];

    const runner = client.beta.messages.toolRunner({
      model: this.options.model ?? DEFAULT_ALLOCATOR_MODEL,
      max_tokens: this.options.maxTokens ?? 4096,
      max_iterations: this.options.maxIterations ?? 16,
      system: systemPrompt(capabilities),
      messages: [
        {
          role: "user",
          content:
            "Allocate the budget across these dependencies' maintainers. Inspect the candidates, then propose a weighting that reflects the funding philosophy.",
        },
      ],
      tools,
    });

    await runner.runUntilDone();

    // Fall back to the deterministic scores if the model never proposed weights.
    const weights = proposed ?? new HeuristicAllocationEngine().computeWeights(capabilities);
    return capabilities.allocate(weights, proposed !== undefined ? this.name : "heuristic-fallback");
  }
}

/** The default engine: Claude when an Anthropic key is configured, else heuristic. */
export function defaultAllocationEngine(): AllocationEngine {
  return process.env["ANTHROPIC_API_KEY"] !== undefined && process.env["ANTHROPIC_API_KEY"].length > 0
    ? new ClaudeAllocationEngine()
    : new HeuristicAllocationEngine();
}
