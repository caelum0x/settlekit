import type { Entitlement } from "@settlekit/common";

/** Query filters for listing a customer's entitlements. */
export interface ListByCustomerOptions {
  /** When true, only return entitlements whose status is "active". */
  activeOnly?: boolean;
  /** Restrict to a single product. */
  productId?: string;
}

/**
 * Persistence boundary for entitlements. Concrete implementations back this with
 * a real datastore (Postgres, etc.); the in-memory implementation in this package
 * is a real, fully-working store used by tests and local development.
 */
export interface EntitlementRepository {
  /**
   * Find the single active entitlement granting access to `productId` for a
   * customer, or null if none exists. Used by hot-path verification.
   */
  findActiveByCustomerProduct(customerId: string, productId: string): Promise<Entitlement | null>;

  /** Look up an entitlement by id. */
  findById(id: string): Promise<Entitlement | null>;

  /** Insert or update an entitlement, returning the stored copy. */
  save(entitlement: Entitlement): Promise<Entitlement>;

  /** List all entitlements for a customer, newest first. */
  listByCustomer(customerId: string, options?: ListByCustomerOptions): Promise<Entitlement[]>;
}
