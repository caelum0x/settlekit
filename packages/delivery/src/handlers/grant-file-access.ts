/**
 * `file_access_grant` handler: grant the purchaser download access to a file
 * asset (returns a signed URL) via the injected FileGrantor.
 */

import type { ActionHandler, ActionOfType, ActionOutput, DeliveryContext } from "../types.js";

type Action = ActionOfType<"file_access_grant">;

export function grantFileAccessHandler(): ActionHandler<Action> {
  return {
    type: "file_access_grant",

    async execute(action: Action, ctx: DeliveryContext): Promise<ActionOutput> {
      const grant = await ctx.clients.file.grant({
        organizationId: ctx.organizationId,
        customerId: ctx.customerId,
        entitlementId: ctx.entitlementId,
        fileId: action.fileId,
      });

      return {
        fileId: grant.fileId,
        url: grant.url,
        expiresAt: grant.expiresAt,
      };
    },

    async rollback(action: Action, _output: ActionOutput, ctx: DeliveryContext): Promise<void> {
      await ctx.clients.file.revoke({ fileId: action.fileId, customerId: ctx.customerId });
    },
  };
}
