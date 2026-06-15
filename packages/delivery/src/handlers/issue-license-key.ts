/**
 * `license_key_create` handler: mint a license key for the purchase via the
 * injected LicenseIssuer.
 */

import type { ActionHandler, ActionOfType, ActionOutput, DeliveryContext } from "../types.js";

type Action = ActionOfType<"license_key_create">;

export function issueLicenseKeyHandler(): ActionHandler<Action> {
  return {
    type: "license_key_create",

    async execute(action: Action, ctx: DeliveryContext): Promise<ActionOutput> {
      const license = await ctx.clients.license.issue({
        organizationId: ctx.organizationId,
        customerId: ctx.customerId,
        productId: ctx.productId,
        entitlementId: ctx.entitlementId,
        policyId: action.policyId,
      });

      return {
        licenseKeyId: license.id,
        // The opaque key string the buyer activates with.
        key: license.key,
        status: license.status,
        machineLimit: license.machineLimit,
        policyId: action.policyId,
      };
    },

    async rollback(_action: Action, output: ActionOutput, ctx: DeliveryContext): Promise<void> {
      const licenseKeyId = output.licenseKeyId;
      if (typeof licenseKeyId !== "string") return;
      await ctx.clients.license.revoke(licenseKeyId);
    },
  };
}
