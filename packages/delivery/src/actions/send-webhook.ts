import type { DeliveryHandler } from "../types.js";

export const sendWebhook: DeliveryHandler = async (action) => {
  if (action.type !== "webhook_send") throw new Error("invalid action");
  return { url: action.url };
};
