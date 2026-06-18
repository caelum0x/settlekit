/**
 * A deterministic decision engine: discover, rank by reputation then price, and
 * buy down the list until the budget or purchase limit is reached, rating each
 * service after use. Used for offline runs, CI, and as the fallback when no
 * Anthropic API key is configured. The Claude engine is the real agentic brain.
 */

import type { AgentCapabilities, DecisionEngine } from "./types.js";

const NEUTRAL_RATING = 3.5;

export class HeuristicDecisionEngine implements DecisionEngine {
  readonly name = "heuristic";

  async run(capabilities: AgentCapabilities): Promise<void> {
    const services = await capabilities.discover();

    const ranked = [...services].sort((a, b) => {
      const ra = a.ratingCount > 0 ? a.ratingAverage : NEUTRAL_RATING;
      const rb = b.ratingCount > 0 ? b.ratingAverage : NEUTRAL_RATING;
      if (rb !== ra) {
        return rb - ra;
      }
      return Number(a.priceUsdc) - Number(b.priceUsdc);
    });

    for (const service of ranked) {
      const status = capabilities.status();
      if (status.maxPurchases !== undefined && status.purchases >= status.maxPurchases) {
        break;
      }
      if (Number(status.remainingUsdc) < Number(service.priceUsdc)) {
        continue;
      }
      const result = await capabilities.buy(service.id);
      if (result.ok && result.record !== undefined) {
        await capabilities.rate(service.id, result.content !== undefined ? 5 : 3);
      }
    }
  }
}
