import type {
  Bundle,
  DeliveryPlan,
  Entitlement,
  Money,
  Payment,
  PriceInterval,
  Result,
  SettleKitError,
} from "@settlekit/common";
import { err, isErr, notFound, ok, toIso } from "@settlekit/common";
import { createBundle, validateBundle, type ProductExistsLookup } from "./bundle.js";
import { buildBundleDeliveryPlan, type DeliveryPlanMember } from "./bundle-delivery-plan.js";
import { buildBundleEntitlements } from "./bundle-entitlements.js";
import type { BundleMember } from "./bundle-items.js";
import type { BundleStore, ListBundlesOptions } from "./store.js";

/** Public input for {@link BundleService.createBundle}. */
export interface CreateBundleRequest {
  merchantId: string;
  organizationId: string;
  name: string;
  description?: string;
  productIds: string[];
  /** Fixed override price. When omitted, member prices are summed. */
  price?: Money;
  /** Member list prices used when no `price` override is supplied. */
  memberPrices?: Money[];
  interval?: PriceInterval;
  now?: Date;
}

/**
 * High-level service for managing bundle products. Validates against an injected
 * product lookup, persists via a {@link BundleStore}, and exposes the pure domain
 * builders (delivery plan, entitlements) as cohesive operations.
 */
export class BundleService {
  constructor(
    private readonly store: BundleStore,
    private readonly productExists: ProductExistsLookup,
  ) {}

  /**
   * Validate and persist a new bundle. Fails with a validation/not_found error
   * (no empty bundle, no self-reference/duplicates, all products exist) without
   * touching the store.
   */
  async createBundle(
    request: CreateBundleRequest,
  ): Promise<Result<Bundle, SettleKitError>> {
    const bundle = createBundle({
      merchantId: request.merchantId,
      organizationId: request.organizationId,
      name: request.name,
      description: request.description,
      productIds: request.productIds,
      price: request.price,
      memberPrices: request.memberPrices,
      interval: request.interval,
      now: request.now,
    });

    const validation = validateBundle({ bundle, productExists: this.productExists });
    if (isErr(validation)) {
      return err(validation.error);
    }

    const saved = await this.store.save(bundle);
    return ok(saved);
  }

  /** Fetch a bundle by id, or a not_found error. */
  async getBundle(id: string): Promise<Result<Bundle, SettleKitError>> {
    const bundle = await this.store.findById(id);
    if (!bundle) {
      return err(notFound(`bundle not found: ${id}`, { bundleId: id }));
    }
    return ok(bundle);
  }

  /** List bundles, optionally filtered. */
  async listBundles(options?: ListBundlesOptions): Promise<Bundle[]> {
    return this.store.list(options);
  }

  /**
   * Build the single combined {@link DeliveryPlan} for a stored bundle from its
   * members' delivery actions (de-duplicated, ordered).
   */
  async buildDeliveryPlan(
    bundleId: string,
    productsWithDeliveryActions: readonly DeliveryPlanMember[],
    now?: Date,
  ): Promise<Result<DeliveryPlan, SettleKitError>> {
    const found = await this.getBundle(bundleId);
    if (isErr(found)) {
      return err(found.error);
    }
    return ok(buildBundleDeliveryPlan(found.value, productsWithDeliveryActions, now));
  }

  /**
   * Build one {@link Entitlement} per member for a confirmed bundle purchase.
   */
  async buildEntitlements(
    bundleId: string,
    payment: Payment,
    members: readonly BundleMember[],
    now?: Date,
  ): Promise<Result<Entitlement[], SettleKitError>> {
    const found = await this.getBundle(bundleId);
    if (isErr(found)) {
      return err(found.error);
    }
    return ok(buildBundleEntitlements(found.value, payment, members, now));
  }

  /** Archive a stored bundle (immutable status transition). */
  async archiveBundle(
    bundleId: string,
    now: Date = new Date(),
  ): Promise<Result<Bundle, SettleKitError>> {
    const found = await this.getBundle(bundleId);
    if (isErr(found)) {
      return err(found.error);
    }
    const archived: Bundle = {
      ...found.value,
      status: "archived",
      updatedAt: toIso(now),
    };
    const saved = await this.store.save(archived);
    return ok(saved);
  }
}
