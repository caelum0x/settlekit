/**
 * `webhook_send` handler: POST a signed `delivery.succeeded` webhook to the
 * action's URL via the injected WebhookSender. Sending a webhook is a
 * notification — there is nothing to roll back, so no `rollback` is provided.
 */

import type { ActionHandler, ActionOfType, ActionOutput, DeliveryContext } from "../types.js";

type Action = ActionOfType<"webhook_send">;

export function sendWebhookHandler(): ActionHandler<Action> {
  return {
    type: "webhook_send",

    async execute(action: Action, ctx: DeliveryContext): Promise<ActionOutput> {
      const delivery = await ctx.clients.webhook.send({
        organizationId: ctx.organizationId,
        url: action.url,
        eventType: "delivery.succeeded",
        payload: {
          organizationId: ctx.organizationId,
          customerId: ctx.customerId,
          productId: ctx.productId,
          paymentId: ctx.paymentId,
          entitlementId: ctx.entitlementId,
        },
      });

      return {
        url: delivery.url,
        status: delivery.status,
        eventId: delivery.eventId,
      };
    },
  };
}
