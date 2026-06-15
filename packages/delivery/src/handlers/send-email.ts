/**
 * `email_send` handler: send a transactional delivery email to the purchaser via
 * the injected EmailSender. Email is a notification, so there is no rollback.
 */

import { SettleKitError } from "@settlekit/common";
import type { ActionHandler, ActionOfType, ActionOutput, DeliveryContext } from "../types.js";

type Action = ActionOfType<"email_send">;

export function sendEmailHandler(): ActionHandler<Action> {
  return {
    type: "email_send",

    async execute(action: Action, ctx: DeliveryContext): Promise<ActionOutput> {
      if (!ctx.customerEmail) {
        throw new SettleKitError({
          code: "validation_error",
          message: "No customer email available; cannot send delivery email",
          details: { customerId: ctx.customerId, template: action.template },
        });
      }

      const delivery = await ctx.clients.email.send({
        organizationId: ctx.organizationId,
        to: ctx.customerEmail,
        template: action.template,
        variables: {
          customerId: ctx.customerId,
          productId: ctx.productId,
          paymentId: ctx.paymentId,
          entitlementId: ctx.entitlementId,
          ...(ctx.emailVariables ?? {}),
        },
      });

      return {
        messageId: delivery.messageId,
        to: delivery.to,
        template: delivery.template,
      };
    },
  };
}
