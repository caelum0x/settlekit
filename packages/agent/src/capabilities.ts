/**
 * The concrete capability surface for one agent run. Wraps marketplace
 * discovery, reputation, and the x402 payer — and enforces every spend
 * guardrail in {@link AgentSession.buy} so no decision engine can exceed policy.
 */

import { type Money, compareMoney, isErr, money, toIso } from "@settlekit/common";
import {
  type AgentDiscoveryQuery,
  type AgentReputationStore,
  type AgentService,
  discoverAgentServices,
} from "@settlekit/agent-services";
import { type RequestFetcher, type Settler, payAndFetch } from "@settlekit/x402-client";
import { BudgetTracker } from "./budget.js";
import type {
  AgentCapabilities,
  AgentStatus,
  BuyResult,
  DiscoveredService,
  PurchaseRecord,
  SpendPolicy,
} from "./types.js";

/** Dependencies for an {@link AgentSession}. */
export interface AgentSessionDeps {
  objective: string;
  policy: SpendPolicy;
  services: readonly AgentService[];
  reputation: AgentReputationStore;
  fetcher: RequestFetcher;
  settler: Settler;
  /** Payer address/identifier echoed into payment proofs. */
  from: string;
  /** Discovery filter applied when an engine calls discover() without one. */
  defaultQuery?: AgentDiscoveryQuery;
  now?: () => Date;
  log?: (message: string) => void;
}

function previewOf(content: unknown): string {
  try {
    return JSON.stringify(content).slice(0, 160);
  } catch {
    return String(content).slice(0, 160);
  }
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return await response.text();
  }
}

function clampStars(stars: number): number {
  if (!Number.isFinite(stars)) return 3;
  return Math.max(1, Math.min(5, Math.round(stars)));
}

export class AgentSession implements AgentCapabilities {
  readonly objective: string;
  readonly policy: SpendPolicy;

  private readonly deps: AgentSessionDeps;
  private readonly byId = new Map<string, AgentService>();
  private readonly budget: BudgetTracker;
  private readonly now: () => Date;
  private readonly logSink: (message: string) => void;
  readonly purchases: PurchaseRecord[] = [];
  readonly log: string[] = [];

  constructor(deps: AgentSessionDeps) {
    this.deps = deps;
    this.objective = deps.objective;
    this.policy = deps.policy;
    this.budget = new BudgetTracker(deps.policy.totalBudgetUsdc);
    this.now = deps.now ?? (() => new Date());
    this.logSink = deps.log ?? (() => {});
    for (const service of deps.services) {
      this.byId.set(service.id, service);
    }
  }

  get totalSpent(): Money {
    return this.budget.spent;
  }

  get remaining(): Money {
    return this.budget.remaining;
  }

  private note(message: string): void {
    this.log.push(message);
    this.logSink(message);
  }

  private async toDiscovered(service: AgentService): Promise<DiscoveredService> {
    const rep = await this.deps.reputation.get(service.id);
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      endpoint: service.endpoint,
      priceUsdc: service.price,
      network: service.network === "base" ? "base" : "arc",
      ratingAverage: rep.ratingAverage,
      ratingCount: rep.ratingCount,
    };
  }

  async discover(query?: AgentDiscoveryQuery): Promise<DiscoveredService[]> {
    const matched = discoverAgentServices(this.deps.services, query ?? this.deps.defaultQuery);
    const enriched = await Promise.all(matched.map((s) => this.toDiscovered(s)));
    this.note(`discovered ${enriched.length} service(s)`);
    return enriched;
  }

  async evaluate(serviceId: string): Promise<DiscoveredService | null> {
    const service = this.byId.get(serviceId);
    if (service === undefined) {
      return null;
    }
    return this.toDiscovered(service);
  }

  async buy(serviceId: string): Promise<BuyResult> {
    const max = this.policy.maxPurchases;
    if (max !== undefined && this.purchases.length >= max) {
      return { ok: false, reason: "purchase limit reached" };
    }

    const service = this.byId.get(serviceId);
    if (service === undefined) {
      return { ok: false, reason: `unknown service ${serviceId}` };
    }

    const price = money(service.price);

    if (this.policy.minReputation !== undefined) {
      const rep = await this.deps.reputation.get(serviceId);
      if (rep.ratingCount > 0 && rep.ratingAverage < this.policy.minReputation) {
        return {
          ok: false,
          reason: `reputation ${rep.ratingAverage.toFixed(2)} below threshold ${this.policy.minReputation}`,
        };
      }
    }

    if (!this.budget.canAfford(price)) {
      return {
        ok: false,
        reason: `price ${service.price} USDC exceeds remaining budget ${this.budget.remaining.amount} USDC`,
      };
    }

    // Hard-cap the call at the tighter of the catalog price and the policy
    // per-call cap. This way a buggy or adversarial endpoint that advertises a
    // higher price in its 402 challenge than the catalog is rejected before any
    // payment — `canAfford` was checked against the catalog price, so the actual
    // charge can never exceed what we authorized.
    const policyCap = this.policy.maxPriceUsdc;
    const callCap =
      policyCap !== undefined && compareMoney(money(policyCap), price) < 0 ? policyCap : price.amount;

    const result = await payAndFetch(service.endpoint, {
      fetcher: this.deps.fetcher,
      settler: this.deps.settler,
      from: this.deps.from,
      maxPriceUsdc: callCap,
    });

    if (isErr(result)) {
      this.note(`buy ${service.name} failed: ${result.error.message}`);
      return { ok: false, reason: result.error.message };
    }

    const content = await readBody(result.value.response);

    if (!result.value.paid) {
      this.note(`accessed ${service.name} (no toll)`);
      return { ok: true, content };
    }

    const amount = result.value.amount ?? price;
    this.budget.record(amount);
    const record: PurchaseRecord = {
      serviceId,
      endpoint: service.endpoint,
      amount,
      txHash: result.value.proof?.txHash ?? "",
      contentPreview: previewOf(content),
      at: toIso(this.now()),
    };
    this.purchases.push(record);
    this.note(
      `paid ${amount.amount} USDC for "${service.name}" — remaining ${this.budget.remaining.amount} USDC`,
    );
    return { ok: true, content, record };
  }

  async rate(serviceId: string, stars: number): Promise<void> {
    const clamped = clampStars(stars);
    await this.deps.reputation.recordRating(serviceId, clamped);
    let lastIndex = -1;
    for (let i = this.purchases.length - 1; i >= 0; i -= 1) {
      if (this.purchases[i]?.serviceId === serviceId) {
        lastIndex = i;
        break;
      }
    }
    if (lastIndex >= 0) {
      const prev = this.purchases[lastIndex];
      if (prev !== undefined) {
        this.purchases[lastIndex] = { ...prev, rating: clamped };
      }
    }
    this.note(`rated ${serviceId} ${clamped}/5`);
  }

  status(): AgentStatus {
    return {
      spentUsdc: this.budget.spent.amount,
      remainingUsdc: this.budget.remaining.amount,
      purchases: this.purchases.length,
      ...(this.policy.maxPurchases !== undefined ? { maxPurchases: this.policy.maxPurchases } : {}),
    };
  }
}
