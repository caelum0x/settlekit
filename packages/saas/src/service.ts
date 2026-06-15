/**
 * SaaS service: ties the store boundaries to the pure domain logic (plan §20).
 *
 * This is the high-level façade the API/SDK calls. It owns no business rules of
 * its own beyond orchestration + persistence; all decisions delegate to the pure
 * functions in this package.
 */
import { notFound, ok, err } from "@settlekit/common";
import type {
  Entitlement,
  Subscription,
  Customer,
  Result,
  SettleKitError,
} from "@settlekit/common";
import {
  createPlan,
  type CreatePlanInput,
  type SaasPlan,
} from "./saas-plan.js";
import { featureEnabled, featureLimit } from "./feature-flags.js";
import { SeatManager, type Seat } from "./seat-limits.js";
import {
  tenantEntitlement,
  type TenantEntitlementInput,
} from "./tenant-entitlements.js";
import { usageLimits, type UsageDecision } from "./usage-limits.js";
import {
  upgradeDowngrade,
  type ProrationResult,
} from "./upgrade-downgrade.js";
import { applyGracePeriod, type GracePeriodInput } from "./grace-periods.js";
import { portalSummary, type PortalSummary } from "./customer-portal.js";
import { orgBillingSummary, type OrgBillingSummary, type OrgSubscription } from "./org-billing.js";
import type { PlanStore, SeatStore, SeatRecord } from "./store.js";

/** Dependencies the {@link SaasService} requires. */
export interface SaasServiceDeps {
  plans: PlanStore;
  seats: SeatStore;
}

/**
 * Orchestrates SaaS plan/billing/entitlement operations over real stores.
 */
export class SaasService {
  private readonly plans: PlanStore;
  private readonly seats: SeatStore;

  constructor(deps: SaasServiceDeps) {
    this.plans = deps.plans;
    this.seats = deps.seats;
  }

  // ---- Plans -------------------------------------------------------------

  /** Create and persist a plan. */
  async createPlan(input: CreatePlanInput): Promise<Result<SaasPlan, SettleKitError>> {
    const result = createPlan(input);
    if (!result.ok) return result;
    const saved = await this.plans.save(result.value);
    return ok(saved);
  }

  /** List plans, optionally filtered by product. */
  async listPlans(options: { productId?: string } = {}): Promise<SaasPlan[]> {
    return this.plans.list(options);
  }

  /** Fetch a plan or fail with `not_found`. */
  async getPlan(id: string): Promise<Result<SaasPlan, SettleKitError>> {
    const plan = await this.plans.findById(id);
    return plan ? ok(plan) : err(notFound(`Plan ${id} not found`, { id }));
  }

  // ---- Entitlements ------------------------------------------------------

  /**
   * Build a `saas_feature` entitlement from a plan purchase. The plan is loaded
   * from the store by id to guarantee the entitlement reflects persisted state.
   */
  async grantEntitlement(
    input: Omit<TenantEntitlementInput, "plan"> & { planId: string },
  ): Promise<Result<Entitlement, SettleKitError>> {
    const plan = await this.plans.findById(input.planId);
    if (!plan) return err(notFound(`Plan ${input.planId} not found`, { id: input.planId }));
    const { planId: _planId, ...rest } = input;
    void _planId;
    return ok(tenantEntitlement({ ...rest, plan }));
  }

  /** Resolve whether a feature flag is enabled for an entitlement. */
  featureEnabled(entitlement: Entitlement, key: string): boolean {
    return featureEnabled(entitlement, key);
  }

  /** Resolve a numeric feature limit for an entitlement. */
  featureLimit(entitlement: Entitlement, key: string): number | undefined {
    return featureLimit(entitlement, key);
  }

  /** Gate a usage increment against an entitlement's numeric features. */
  checkUsage(
    entitlement: Entitlement,
    metric: string,
    currentUsage: number,
    increment = 1,
  ): UsageDecision {
    return usageLimits(entitlement, metric, currentUsage, increment);
  }

  // ---- Seats -------------------------------------------------------------

  /** Load the {@link SeatManager} for a customer, creating an empty allocation. */
  private async loadSeatManager(
    customerId: string,
    seatLimit: number,
  ): Promise<SeatManager> {
    const record = await this.seats.get(customerId);
    if (record) {
      return new SeatManager({ seatLimit: record.seatLimit, seats: record.seats });
    }
    return new SeatManager({ seatLimit, seats: [] });
  }

  private async persistSeats(customerId: string, manager: SeatManager): Promise<SeatRecord> {
    return this.seats.save({
      customerId,
      seatLimit: manager.seatLimit,
      seats: manager.listSeats(),
    });
  }

  /**
   * Add a seat for `userId` under `customerId`. The seat limit comes from the
   * referenced plan when the customer has no existing allocation.
   */
  async addSeat(
    customerId: string,
    userId: string,
    planId: string,
    now: Date = new Date(),
  ): Promise<Result<Seat[], SettleKitError>> {
    const plan = await this.plans.findById(planId);
    if (!plan) return err(notFound(`Plan ${planId} not found`, { id: planId }));

    const manager = await this.loadSeatManager(customerId, plan.seats);
    const result = manager.addSeat(userId, now);
    if (!result.ok) return result;
    await this.persistSeats(customerId, result.value);
    return ok(result.value.listSeats());
  }

  /** Remove a seat for `userId` under `customerId`. */
  async removeSeat(
    customerId: string,
    userId: string,
  ): Promise<Result<Seat[], SettleKitError>> {
    const record = await this.seats.get(customerId);
    if (!record) return err(notFound(`No seats for customer ${customerId}`, { customerId }));
    const manager = new SeatManager({ seatLimit: record.seatLimit, seats: record.seats });
    const result = manager.removeSeat(userId);
    if (!result.ok) return result;
    await this.persistSeats(customerId, result.value);
    return ok(result.value.listSeats());
  }

  /** List the seats currently assigned to a customer. */
  async listSeats(customerId: string): Promise<Seat[]> {
    const record = await this.seats.get(customerId);
    return record ? record.seats.map((s) => ({ ...s })) : [];
  }

  // ---- Upgrade / downgrade ----------------------------------------------

  /**
   * Compute proration for switching a subscription to `newPlanId`. The current
   * and target plans are loaded from the store.
   */
  async changePlan(
    currentSub: Subscription,
    currentPlanId: string,
    newPlanId: string,
    now: Date = new Date(),
  ): Promise<Result<ProrationResult, SettleKitError>> {
    const [currentPlan, newPlan] = await Promise.all([
      this.plans.findById(currentPlanId),
      this.plans.findById(newPlanId),
    ]);
    if (!currentPlan) return err(notFound(`Plan ${currentPlanId} not found`, { id: currentPlanId }));
    if (!newPlan) return err(notFound(`Plan ${newPlanId} not found`, { id: newPlanId }));
    return upgradeDowngrade({ currentSub, currentPlan, newPlan, now });
  }

  // ---- Grace periods -----------------------------------------------------

  /** Advance a subscription through its renewal grace lifecycle. */
  applyGracePeriod(input: GracePeriodInput): Subscription {
    return applyGracePeriod(input);
  }

  // ---- Reporting ---------------------------------------------------------

  /** Build the self-service portal read-model for a customer. */
  portalSummary(
    customer: Customer,
    subs: readonly Subscription[],
    entitlements: readonly Entitlement[],
  ): PortalSummary {
    return portalSummary(customer, subs, entitlements);
  }

  /** Build an organization-level billing summary. */
  orgBillingSummary(
    organizationId: string,
    subscriptions: readonly OrgSubscription[],
  ): OrgBillingSummary {
    return orgBillingSummary(organizationId, subscriptions);
  }
}
