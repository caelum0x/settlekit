/**
 * The deterministic allocation engine.
 *
 * Scores every candidate from its four signals and hands the scores to the
 * capability layer as weights. The score is a weighted sum, scaled by the
 * dependency's runtime factor:
 *
 *   score = runtimeFactor · ( wD·directness
 *                           + wC·normalizedReach     (log-scaled, criticality)
 *                           + wU·normalizedUsage
 *                           + wF·underfunding )
 *
 * Reach is log-scaled so a package the entire tree leans on dominates without
 * a single hub swallowing the whole budget. This is the offline/CI brain and the
 * fallback when no Anthropic key is set; the Claude engine is the reasoning one.
 */

import type { AllocationCapabilities, AllocationEngine, AllocationWeight } from "./allocation.js";
import type { FundingPlan } from "./types.js";

/** Relative importance of each signal. Must be non-negative; ratios are what matter. */
export interface HeuristicWeights {
  directness: number;
  criticality: number;
  usage: number;
  underfunding: number;
}

export const DEFAULT_HEURISTIC_WEIGHTS: HeuristicWeights = {
  directness: 0.25,
  criticality: 0.3,
  usage: 0.25,
  underfunding: 0.2,
};

export class HeuristicAllocationEngine implements AllocationEngine {
  readonly name = "heuristic";
  private readonly weights: HeuristicWeights;

  constructor(weights: HeuristicWeights = DEFAULT_HEURISTIC_WEIGHTS) {
    this.weights = weights;
  }

  async decide(capabilities: AllocationCapabilities): Promise<FundingPlan> {
    return capabilities.allocate(this.computeWeights(capabilities), this.name);
  }

  /** Exposed so other engines (e.g. the Claude fallback) can reuse the scoring. */
  computeWeights(capabilities: AllocationCapabilities): AllocationWeight[] {
    const candidates = capabilities.candidates();
    let maxLogReach = 0;
    let maxUsage = 0;
    for (const c of candidates) {
      maxLogReach = Math.max(maxLogReach, Math.log1p(c.signals.reach));
      maxUsage = Math.max(maxUsage, c.signals.usage);
    }

    const w = this.weights;
    return candidates.map((c) => {
      const s = c.signals;
      const normReach = maxLogReach > 0 ? Math.log1p(s.reach) / maxLogReach : 0;
      const normUsage = maxUsage > 0 ? s.usage / maxUsage : 0;
      const score =
        s.runtimeFactor *
        (w.directness * s.directness +
          w.criticality * normReach +
          w.usage * normUsage +
          w.underfunding * s.underfunding);
      return { name: c.name, weight: score };
    });
  }
}
