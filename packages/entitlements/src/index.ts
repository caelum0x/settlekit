/**
 * @settlekit/entitlements — the core entitlement engine (plan §14).
 *
 * Universal entitlements: every kind of access (GitHub, SaaS, API, file,
 * Discord, license, package, agent tool) is modeled as an `Entitlement`. This
 * package is pure domain logic plus a repository boundary and a high-level
 * service that ties them together.
 */

// Granting
export {
  grantFromPayment,
  grantFromSubscription,
  resolveEntitlementType,
  type GrantFromPaymentInput,
  type GrantFromSubscriptionInput,
} from "./grant.js";

// Verification (pure checks)
export {
  verifyFeature,
  verifyCredits,
  checkSeat,
  assertPositiveAmount,
  type VerifyResult,
} from "./verify.js";

// Credits
export { deductCredits, addCredits } from "./credits.js";

// Lifecycle
export { isActive, expireDue, expire, revoke } from "./lifecycle.js";

// Repository boundary + in-memory implementation
export type { EntitlementRepository, ListByCustomerOptions } from "./repository.js";
export { InMemoryEntitlementRepository } from "./in-memory-repository.js";

// High-level service
export {
  EntitlementService,
  type ServiceVerifyInput,
  type ServiceVerifyResult,
} from "./service.js";
