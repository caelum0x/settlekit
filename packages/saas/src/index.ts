/**
 * @settlekit/saas — SaaS plan billing + entitlements (plan §4, §20).
 *
 * Pure domain logic for SaaS plans, feature flags/limits, seats, tenant
 * entitlements, proration, grace periods, usage gates, and the customer portal
 * read-model, plus store boundaries with real in-memory implementations and a
 * high-level {@link SaasService} façade.
 */

// Plans
export {
  createPlan,
  listPlans,
  UNLIMITED,
  type SaasPlan,
  type PlanInterval,
  type CreatePlanInput,
} from "./saas-plan.js";

// Feature flags + limits
export { featureEnabled, featureLimit, type FeatureSource } from "./feature-flags.js";

// Seats
export {
  SeatManager,
  type Seat,
  type SeatState,
} from "./seat-limits.js";

// Tenant entitlements
export {
  tenantEntitlement,
  type TenantEntitlementInput,
} from "./tenant-entitlements.js";

// Usage limits
export { usageLimits, type UsageDecision } from "./usage-limits.js";

// Upgrade / downgrade proration
export {
  upgradeDowngrade,
  type ChangeKind,
  type ProrationResult,
  type UpgradeDowngradeInput,
} from "./upgrade-downgrade.js";

// Grace periods
export {
  applyGracePeriod,
  graceEndsAt,
  isAccessActive,
  type GracePeriodInput,
} from "./grace-periods.js";

// Org billing
export {
  orgBillingSummary,
  type OrgSubscription,
  type OrgBillingSummary,
} from "./org-billing.js";

// Customer portal
export {
  portalSummary,
  type PortalSummary,
  type PortalSubscription,
  type PortalEntitlement,
} from "./customer-portal.js";

// Stores
export {
  InMemoryPlanStore,
  InMemorySeatStore,
  type PlanStore,
  type SeatStore,
  type SeatRecord,
} from "./store.js";

// Service
export { SaasService, type SaasServiceDeps } from "./service.js";
