import type { Entitlement, Payment, Product, Subscription } from "@settlekit/common";
import { notFound } from "@settlekit/common";
import { deductCredits } from "./credits.js";
import {
  grantFromPayment,
  grantFromSubscription,
  type GrantFromPaymentInput,
  type GrantFromSubscriptionInput,
} from "./grant.js";
import { expireDue, isActive, revoke } from "./lifecycle.js";
import type { EntitlementRepository } from "./repository.js";
import { checkSeat, verifyCredits, verifyFeature, type VerifyResult } from "./verify.js";

/** Input for the SDK-style `verify` call (plan §4). */
export interface ServiceVerifyInput {
  customerId: string;
  /** Verify a SaaS feature flag/limit. */
  feature?: string;
  /** Restrict the search to a single product. */
  productId?: string;
  /** Verify available credits. */
  requiredCredits?: number;
  now?: Date;
}

/** Result of a service-level verification. */
export interface ServiceVerifyResult {
  allowed: boolean;
  reason?: string;
  value?: boolean | number | string;
  entitlement?: Entitlement;
}

/**
 * High-level service that ties the EntitlementRepository to the pure domain
 * logic. This is what the SDK calls: `service.verify({ customerId, feature })`.
 */
export class EntitlementService {
  constructor(private readonly repo: EntitlementRepository) {}

  /**
   * Verify access for a customer. Resolves the relevant active entitlement(s),
   * then applies feature / credit checks. When `productId` is omitted and a
   * `feature` is requested, every active entitlement is scanned for that feature.
   */
  async verify(input: ServiceVerifyInput): Promise<ServiceVerifyResult> {
    const now = input.now ?? new Date();

    if (input.productId) {
      const entitlement = await this.repo.findActiveByCustomerProduct(
        input.customerId,
        input.productId,
      );
      if (!entitlement || !isActive(entitlement, now)) {
        return { allowed: false, reason: "no_active_entitlement" };
      }
      return applyChecks(entitlement, input);
    }

    const active = (await this.repo.listByCustomer(input.customerId, { activeOnly: true })).filter(
      (e) => isActive(e, now),
    );
    if (active.length === 0) {
      return { allowed: false, reason: "no_active_entitlement" };
    }

    // Find the first entitlement that satisfies the requested check.
    let lastResult: ServiceVerifyResult = { allowed: false, reason: "no_active_entitlement" };
    for (const entitlement of active) {
      const result = applyChecks(entitlement, input);
      if (result.allowed) return result;
      lastResult = result;
    }
    return lastResult;
  }

  /** Grant an entitlement from a confirmed payment and persist it. */
  async grantFromPayment(input: GrantFromPaymentInput): Promise<Entitlement> {
    return this.repo.save(grantFromPayment(input));
  }

  /** Grant an entitlement from a subscription and persist it. */
  async grantFromSubscription(input: GrantFromSubscriptionInput): Promise<Entitlement> {
    return this.repo.save(grantFromSubscription(input));
  }

  /**
   * Spend `amount` credits against a customer's product entitlement, persisting
   * the new balance. Throws `insufficient_credits` when short, `not_found` when
   * there is no active entitlement.
   */
  async spendCredits(
    customerId: string,
    productId: string,
    amount: number,
    now: Date = new Date(),
  ): Promise<Entitlement> {
    const entitlement = await this.repo.findActiveByCustomerProduct(customerId, productId);
    if (!entitlement) {
      throw notFound("no active entitlement for customer/product", { customerId, productId });
    }
    const updated = deductCredits(entitlement, amount, now);
    return this.repo.save(updated);
  }

  /** Revoke an entitlement by id and persist the change. */
  async revoke(entitlementId: string, reason: string, now: Date = new Date()): Promise<Entitlement> {
    const entitlement = await this.repo.findById(entitlementId);
    if (!entitlement) {
      throw notFound("entitlement not found", { entitlementId });
    }
    return this.repo.save(revoke(entitlement, reason, now));
  }

  /**
   * Sweep a customer's entitlements and transition any past-due active ones to
   * "expired", returning the entitlements that were expired.
   */
  async expireDueForCustomer(customerId: string, now: Date = new Date()): Promise<Entitlement[]> {
    const all = await this.repo.listByCustomer(customerId);
    const due = expireDue(all, now);
    const expired: Entitlement[] = [];
    for (const entitlement of due) {
      const saved = await this.repo.save({
        ...entitlement,
        status: "expired",
        updatedAt: now.toISOString(),
      });
      expired.push(saved);
    }
    return expired;
  }
}

/** Apply the requested feature / credit / seat checks against one entitlement. */
function applyChecks(entitlement: Entitlement, input: ServiceVerifyInput): ServiceVerifyResult {
  if (input.feature !== undefined) {
    const result = verifyFeature(entitlement, input.feature);
    return withEntitlement(result, entitlement);
  }
  if (input.requiredCredits !== undefined) {
    const result = verifyCredits(entitlement, input.requiredCredits);
    return withEntitlement(result, entitlement);
  }
  // No specific check requested: an active entitlement alone is sufficient.
  return { allowed: true, entitlement };
}

function withEntitlement(result: VerifyResult, entitlement: Entitlement): ServiceVerifyResult {
  return {
    allowed: result.allowed,
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
    ...(result.value !== undefined ? { value: result.value } : {}),
    entitlement,
  };
}

export { checkSeat };
