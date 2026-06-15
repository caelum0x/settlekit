import type {
  DeliveryAction,
  DeliveryActionType,
  Entitlement,
  EntitlementType,
  IsoTimestamp,
  Payment,
  Product,
  ProductType,
  Subscription,
} from "@settlekit/common";
import { generateId, toIso, validationError } from "@settlekit/common";

/**
 * Map a delivery action to the entitlement type it materializes. The delivery
 * action is the source of truth: it describes the concrete access being granted.
 */
const DELIVERY_ACTION_ENTITLEMENT: Record<DeliveryActionType, EntitlementType> = {
  github_invite: "github_repo_access",
  github_team_add: "github_team_access",
  license_key_create: "license_key",
  api_key_create: "api_access",
  file_access_grant: "file_access",
  discord_role_add: "discord_role",
  saas_entitlement_create: "saas_feature",
  // webhook_send / email_send do not themselves grant durable access; the
  // entitlement they accompany is the product itself (notification side-effect).
  webhook_send: "saas_feature",
  email_send: "saas_feature",
};

/**
 * Fallback mapping when no delivery action is supplied: derive the entitlement
 * type from the product type. Keeps grants correct for products whose delivery
 * is implicit (e.g. a pure SaaS plan with feature flags).
 */
const PRODUCT_ENTITLEMENT: Record<ProductType, EntitlementType> = {
  saas_plan: "saas_feature",
  github_repo_access: "github_repo_access",
  github_org_team_access: "github_team_access",
  api_access: "api_access",
  paid_api_call: "api_credits",
  ai_agent_service: "agent_service",
  digital_download: "file_access",
  code_template: "file_access",
  dataset: "file_access",
  license_key: "license_key",
  private_package: "private_package",
  discord_access: "discord_role",
  support_plan: "support_plan",
  course_or_content: "file_access",
  consulting_slot: "support_plan",
  escrow_task: "agent_service",
  bundle: "saas_feature",
};

/** Resolve the entitlement type for a grant from its delivery action + product. */
export function resolveEntitlementType(
  product: Product,
  deliveryAction?: DeliveryAction,
): EntitlementType {
  if (deliveryAction) {
    return DELIVERY_ACTION_ENTITLEMENT[deliveryAction.type];
  }
  return PRODUCT_ENTITLEMENT[product.type];
}

/**
 * Extract the entitlement payload (features / credits / seats / resourceId)
 * implied by a delivery action. Pure: returns a partial entitlement shape.
 */
function payloadFromAction(action: DeliveryAction): Partial<Entitlement> {
  switch (action.type) {
    case "github_invite":
      return { resourceId: action.repoId };
    case "github_team_add":
      return { resourceId: `${action.orgLogin}/${action.teamSlug}` };
    case "license_key_create":
      return { resourceId: action.policyId };
    case "api_key_create":
      return { features: Object.fromEntries(action.scopes.map((s) => [s, true])) };
    case "file_access_grant":
      return { resourceId: action.fileId };
    case "discord_role_add":
      return { resourceId: `${action.guildId}/${action.roleId}` };
    case "saas_entitlement_create":
      return { features: { ...action.features } };
    case "webhook_send":
    case "email_send":
      return {};
  }
}

export interface GrantFromPaymentInput {
  payment: Payment;
  product: Product;
  deliveryAction?: DeliveryAction;
  /** Optional explicit feature/limit map (merged over action-derived features). */
  features?: Record<string, boolean | number | string>;
  /** Initial credit balance for credit-based entitlements. */
  creditsRemaining?: number;
  /** Seat allotment for team plans. */
  seats?: number;
  /** Concrete resource id override (repo id, file id, ...). */
  resourceId?: string;
  expiresAt?: IsoTimestamp;
  now?: Date;
}

/**
 * Create an active entitlement from a confirmed payment. The entitlement type
 * is derived from the delivery action when present, otherwise from the product.
 */
export function grantFromPayment(input: GrantFromPaymentInput): Entitlement {
  const { payment, product, deliveryAction } = input;
  if (payment.customerId !== undefined && payment.customerId.length === 0) {
    throw validationError("payment.customerId is required to grant an entitlement");
  }
  const now = input.now ?? new Date();
  const nowIso = toIso(now);
  const entitlementType = resolveEntitlementType(product, deliveryAction);
  const actionPayload = deliveryAction ? payloadFromAction(deliveryAction) : {};

  const features = mergeFeatures(actionPayload.features, input.features);

  const entitlement: Entitlement = {
    id: generateId("entitlement"),
    organizationId: payment.organizationId,
    customerId: payment.customerId,
    productId: product.id,
    grantedBy: { type: "payment", id: payment.id },
    entitlementType,
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return applyOptionalFields(entitlement, {
    resourceId: input.resourceId ?? actionPayload.resourceId,
    features,
    creditsRemaining: input.creditsRemaining,
    seats: input.seats,
    expiresAt: input.expiresAt,
  });
}

export interface GrantFromSubscriptionInput {
  subscription: Subscription;
  product: Product;
  deliveryAction?: DeliveryAction;
  features?: Record<string, boolean | number | string>;
  creditsRemaining?: number;
  seats?: number;
  resourceId?: string;
  /** Defaults to the subscription's current period end. */
  expiresAt?: IsoTimestamp;
  now?: Date;
}

/**
 * Create an active entitlement from a subscription. Access expires at the end of
 * the current billing period unless an explicit `expiresAt` is provided.
 */
export function grantFromSubscription(input: GrantFromSubscriptionInput): Entitlement {
  const { subscription, product, deliveryAction } = input;
  const now = input.now ?? new Date();
  const nowIso = toIso(now);
  const entitlementType = resolveEntitlementType(product, deliveryAction);
  const actionPayload = deliveryAction ? payloadFromAction(deliveryAction) : {};
  const features = mergeFeatures(actionPayload.features, input.features);

  const entitlement: Entitlement = {
    id: generateId("entitlement"),
    organizationId: subscription.organizationId,
    customerId: subscription.customerId,
    productId: product.id,
    grantedBy: { type: "subscription", id: subscription.id },
    entitlementType,
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return applyOptionalFields(entitlement, {
    resourceId: input.resourceId ?? actionPayload.resourceId,
    features,
    creditsRemaining: input.creditsRemaining,
    seats: input.seats,
    expiresAt: input.expiresAt ?? subscription.currentPeriodEnd,
  });
}

function mergeFeatures(
  fromAction?: Record<string, boolean | number | string>,
  explicit?: Record<string, boolean | number | string>,
): Record<string, boolean | number | string> | undefined {
  if (!fromAction && !explicit) return undefined;
  return { ...(fromAction ?? {}), ...(explicit ?? {}) };
}

interface OptionalFields {
  resourceId?: string;
  features?: Record<string, boolean | number | string>;
  creditsRemaining?: number;
  seats?: number;
  expiresAt?: IsoTimestamp;
}

/** Attach only the optional fields that are defined (keeps objects clean under exactOptionalPropertyTypes). */
function applyOptionalFields(entitlement: Entitlement, fields: OptionalFields): Entitlement {
  return {
    ...entitlement,
    ...(fields.resourceId !== undefined ? { resourceId: fields.resourceId } : {}),
    ...(fields.features !== undefined ? { features: fields.features } : {}),
    ...(fields.creditsRemaining !== undefined ? { creditsRemaining: fields.creditsRemaining } : {}),
    ...(fields.seats !== undefined ? { seats: fields.seats } : {}),
    ...(fields.expiresAt !== undefined ? { expiresAt: fields.expiresAt } : {}),
  };
}
