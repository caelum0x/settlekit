import type { DeliveryHandler } from "../types.js";

export const sendEmail: DeliveryHandler = async (action) => {
  if (action.type !== "email_send") throw new Error("invalid action");
  return { template: action.template };
};
