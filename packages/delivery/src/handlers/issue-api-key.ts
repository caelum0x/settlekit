/**
 * `api_key_create` handler: issue a scoped API key via the injected ApiKeyIssuer.
 * The plaintext is returned in the output exactly once so the delivery layer can
 * surface it to the buyer; it is never persisted in plaintext by the issuer.
 */

import type { ActionHandler, ActionOfType, ActionOutput, DeliveryContext } from "../types.js";

type Action = ActionOfType<"api_key_create">;

export function issueApiKeyHandler(): ActionHandler<Action> {
  return {
    type: "api_key_create",

    async execute(action: Action, ctx: DeliveryContext): Promise<ActionOutput> {
      const issued = await ctx.clients.apiKey.issue({
        organizationId: ctx.organizationId,
        customerId: ctx.customerId,
        productId: ctx.productId,
        entitlementId: ctx.entitlementId,
        scopes: action.scopes,
      });

      return {
        apiKeyId: issued.apiKey.id,
        keyPrefix: issued.apiKey.keyPrefix,
        // Shown once to the buyer; downstream code must not log/store this.
        plaintext: issued.plaintext,
        scopes: issued.apiKey.scopes,
        status: issued.apiKey.status,
      };
    },

    async rollback(_action: Action, output: ActionOutput, ctx: DeliveryContext): Promise<void> {
      const apiKeyId = output.apiKeyId;
      if (typeof apiKeyId !== "string") return;
      await ctx.clients.apiKey.revoke(apiKeyId);
    },
  };
}
