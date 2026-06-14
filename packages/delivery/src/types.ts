import type { DeliveryAction, DeliveryActionRun, DeliveryPlan, DeliveryRun } from "@settlekit/common";

export type DeliveryHandler = (action: DeliveryAction, context: DeliveryContext) => Promise<Record<string, unknown> | void>;

export interface DeliveryContext {
  organizationId: string;
  paymentId: string;
  customerId: string;
  collectedFields?: Record<string, string>;
}

export type DeliveryHandlerRegistry = {
  [K in DeliveryAction["type"]]?: DeliveryHandler;
};

export interface RunDeliveryPlanInput {
  plan: DeliveryPlan;
  context: DeliveryContext;
  handlers: DeliveryHandlerRegistry;
  now?: Date;
}

export type { DeliveryAction, DeliveryActionRun, DeliveryPlan, DeliveryRun };
