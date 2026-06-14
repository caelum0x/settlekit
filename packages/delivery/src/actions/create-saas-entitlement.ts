import type { DeliveryHandler } from "../types.js";

export const createSaasEntitlement: DeliveryHandler = async (action) => {
  if (action.type !== "saas_entitlement_create") throw new Error("invalid action");
  return { features: action.features };
};
