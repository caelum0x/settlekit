/**
 * `saas_entitlement_create` handler: provision SaaS feature flags / limits for
 * the purchaser via the injected SaasEntitler.
 */

import type { ActionHandler, ActionOfType, ActionOutput, DeliveryContext } from "../types.js";

type Action = ActionOfType<"saas_entitlement_create">;

export function createSaasEntitlementHandler(): ActionHandler<Action> {
  return {
    type: "saas_entitlement_create",

    async execute(action: Action, ctx: DeliveryContext): Promise<ActionOutput> {
      const grant = await ctx.clients.saas.entitle({
        organizationId: ctx.organizationId,
        customerId: ctx.customerId,
        productId: ctx.productId,
        entitlementId: ctx.entitlementId,
        features: action.features,
      });

      return {
        entitlementId: grant.entitlementId,
        features: grant.features,
      };
    },

    async rollback(_action: Action, output: ActionOutput, ctx: DeliveryContext): Promise<void> {
      const entitlementId =
        typeof output.entitlementId === "string" ? output.entitlementId : ctx.entitlementId;
      await ctx.clients.saas.revoke({ entitlementId });
    },
  };
}
