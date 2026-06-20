import type { Bundle, Money, PriceInterval, ProductStatus, Result } from "@settlekit/common";
import {
  SettleKitError,
  err,
  generateId,
  ok,
  toIso,
  validationError,
} from "@settlekit/common";
import { resolveBundlePrice } from "./bundle-pricing.js";

/** Input for {@link createBundle}. */
export interface CreateBundleInput {
  merchantId: string;
  organizationId: string;
  name: string;
  description?: string;
  /** Product ids included in the bundle, in delivery order. */
  productIds: string[];
  /**
   * Fixed override price for the whole bundle. When omitted, the bundle price is
   * derived by summing member prices (see {@link resolveBundlePrice}).
   */
  price?: Money;
  /**
   * Member prices used to compute the summed price when `price` is omitted.
   * Ignored when an explicit `price` override is supplied.
   */
  memberPrices?: Money[];
  interval?: PriceInterval;
  status?: ProductStatus;
  /** Injected clock for deterministic timestamps (defaults to now). */
  now?: Date;
}

/**
 * Construct a new {@link Bundle} value. Pure and immutable — it returns a fresh
 * object and never mutates its inputs. Structural validation (non-empty, no
 * cycles, all products exist) is handled separately by `validateBundle` so this
 * factory stays side-effect free.
 */
export function createBundle(input: CreateBundleInput): Bundle {
  const now = input.now ?? new Date();
  const createdAt = toIso(now);
  const price = resolveBundlePrice({
    override: input.price,
    memberPrices: input.memberPrices ?? [],
  });

  return {
    id: generateId("bundle"),
    merchantId: input.merchantId,
    organizationId: input.organizationId,
    name: input.name,
    description: input.description ?? "",
    productIds: [...input.productIds],
    price,
    interval: input.interval ?? "one_time",
    status: input.status ?? "active",
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Lookup of whether a product id exists/belongs to the bundle's organization.
 * Injected so validation stays decoupled from the product store. May be async
 * so it can consult a database directly — never a process-local cache, which
 * goes stale across instances under horizontal scaling.
 */
export type ProductExistsLookup = (productId: string) => boolean | Promise<boolean>;

/** Input for {@link validateBundle}. */
export interface ValidateBundleInput {
  bundle: Pick<Bundle, "id" | "productIds">;
  /** Returns true when the product id exists and may be bundled. */
  productExists: ProductExistsLookup;
}

/**
 * Structurally validate a bundle:
 *  - it must contain at least one product (no empty bundles);
 *  - it must not reference itself or contain duplicate product ids (no cycles);
 *  - every referenced product must exist via the injected lookup.
 *
 * Returns a {@link Result} so callers can branch without exceptions.
 */
export async function validateBundle(
  input: ValidateBundleInput,
): Promise<Result<true, SettleKitError>> {
  const { bundle, productExists } = input;

  if (bundle.productIds.length === 0) {
    return err(validationError("bundle must contain at least one product"));
  }

  const seen = new Set<string>();
  for (const productId of bundle.productIds) {
    if (productId === bundle.id) {
      return err(
        validationError("bundle cannot contain itself", { bundleId: bundle.id }),
      );
    }
    if (seen.has(productId)) {
      return err(
        validationError("bundle contains a duplicate product", { productId }),
      );
    }
    seen.add(productId);

    if (!(await productExists(productId))) {
      return err(
        new SettleKitError({
          code: "not_found",
          message: `product not found: ${productId}`,
          details: { productId },
        }),
      );
    }
  }

  return ok(true);
}
